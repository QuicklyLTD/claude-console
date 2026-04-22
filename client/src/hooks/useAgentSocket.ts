import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClientMessage, ServerMessage } from "@shared/protocol";
import { ConsoleSocket, type WsStatus } from "@/lib/ws";
import { AsyncEmitter } from "@/lib/emitter";
import { useSessionStore } from "@/store/session";
import { usePermissionStore } from "@/store/permission";

/**
 * Single persistent WebSocket connection per tab, bound to the active
 * UI session. Exposes turn-scoped emitters for the ChatModelAdapter
 * and dispatches SDKMessage → stores for UI decorations (cost pills,
 * rate-limit, status, etc.).
 */
export function useAgentSocket(token: string | null) {
  const socketRef = useRef<ConsoleSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>("closed");

  const setStatus = useSessionStore((s) => s.setStatus);
  const setThinking = useSessionStore((s) => s.setThinking);
  const setSdkSessionId = useSessionStore((s) => s.setSdkSessionId);
  const setLastTurn = useSessionStore((s) => s.setLastTurn);
  const setRateLimit = useSessionStore((s) => s.setRateLimit);
  const setSessionTotal = useSessionStore((s) => s.setSessionTotal);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const pushPermission = usePermissionStore((s) => s.pushPermission);

  /** Current turn's emitter (null between turns). */
  const turnEmitterRef = useRef<AsyncEmitter<SDKMessage> | null>(null);

  /** Terminal listeners — invoked on every term_output / term_event frame. */
  type TermFrame =
    | { kind: "output"; data: string }
    | { kind: "event"; event: "opened" | "exited" | "error"; exitCode?: number; message?: string };
  const termListenersRef = useRef<Set<(f: TermFrame) => void>>(new Set());

  const termOpen = useCallback((cols: number, rows: number) => {
    socketRef.current?.send({ kind: "term_open", cols, rows });
  }, []);
  const termInput = useCallback((data: string) => {
    socketRef.current?.send({ kind: "term_input", data });
  }, []);
  const termResize = useCallback((cols: number, rows: number) => {
    socketRef.current?.send({ kind: "term_resize", cols, rows });
  }, []);
  const termClose = useCallback(() => {
    socketRef.current?.send({ kind: "term_close" });
  }, []);
  const onTerm = useCallback((listener: (f: TermFrame) => void) => {
    termListenersRef.current.add(listener);
    return () => { termListenersRef.current.delete(listener); };
  }, []);

  const startTurn = useCallback((
    text: string,
    attachments?: Extract<ClientMessage, { kind: "send" }>["attachments"],
  ): AsyncEmitter<SDKMessage> => {
    const emitter = new AsyncEmitter<SDKMessage>();
    turnEmitterRef.current = emitter;
    setStatus("running");
    const cmd: ClientMessage = { kind: "send", text, ...(attachments?.length ? { attachments } : {}) };
    socketRef.current?.send(cmd);
    return emitter;
  }, [setStatus]);

  const interrupt = useCallback(() => {
    socketRef.current?.send({ kind: "interrupt" });
  }, []);

  const setPermissionMode = useCallback((mode: ClientMessage & { kind: "set_permission_mode" }) => {
    socketRef.current?.send(mode);
  }, []);

  const setModel = useCallback((model: string | null) => {
    socketRef.current?.send({ kind: "set_model", model });
  }, []);

  const decidePermission = useCallback((msg: ClientMessage & { kind: "permission_decision" }) => {
    socketRef.current?.send(msg);
  }, []);

  /** (Re)attach to a different UI session over the same socket. */
  const attach = useCallback((uiSessionId: string, resumeSdkSessionId: string | null) => {
    socketRef.current?.send({ kind: "attach", uiSessionId, resumeSdkSessionId });
  }, []);

  useEffect(() => {
    const socket = new ConsoleSocket({ token });
    socketRef.current = socket;
    const offStatus = socket.onStatus((s) => setWsStatus(s));
    const off = socket.on((msg) => handleServer(msg));
    socket.connect();
    return () => {
      off(); offStatus();
      socket.close();
      socketRef.current = null;
    };

    function handleServer(msg: ServerMessage) {
      switch (msg.kind) {
        case "bridge": {
          if (msg.event === "attached") { setStatus("attached"); }
          else if (msg.event === "started") { setStatus("attached"); }
          else if (msg.event === "ended" || msg.event === "interrupted") {
            setStatus(msg.event === "interrupted" ? "interrupted" : "idle");
            setThinking(false);
            // Close current turn if any.
            turnEmitterRef.current?.end();
            turnEmitterRef.current = null;
          } else if (msg.event === "error") {
            setStatus("error");
            setThinking(false);
            turnEmitterRef.current?.end();
            turnEmitterRef.current = null;
          }
          return;
        }
        case "sdk": {
          const m = msg.message;
          // Update SDK session id on init
          if (m.type === "system" && m.subtype === "init" && m.session_id) {
            setSdkSessionId(m.session_id);
          }
          // Status
          if (m.type === "system" && (m as { subtype?: string }).subtype === "status") {
            const status = (m as { status?: string }).status;
            setThinking(status === "requesting");
          }
          // Rate limit
          if (m.type === "rate_limit_event") {
            const info = (m as { rate_limit_info?: { status: string; resetsAt?: number; rateLimitType?: string } }).rate_limit_info;
            if (info) {
              setRateLimit({
                status: info.status,
                resetsAt: info.resetsAt ?? null,
                rateLimitType: info.rateLimitType ?? null,
              });
            }
          }
          // Forward to current turn emitter.
          turnEmitterRef.current?.push(m);
          // Result ends the turn.
          if (m.type === "result") {
            turnEmitterRef.current?.end();
            turnEmitterRef.current = null;
            setStatus("attached");
            setThinking(false);
          }
          return;
        }
        case "permission_request": {
          pushPermission({
            requestId: msg.requestId,
            toolName: msg.toolName,
            toolUseID: msg.toolUseID,
            input: msg.input,
            title: msg.title,
            displayName: msg.displayName,
            description: msg.description,
            decisionReason: msg.decisionReason,
            blockedPath: msg.blockedPath,
            suggestions: msg.suggestions,
            receivedAt: Date.now(),
          });
          return;
        }
        case "cost_update": {
          setLastTurn({
            turnCostUsd: msg.turnCostUsd,
            durationMs: msg.turnDurationMs,
            input: msg.turnTokens.input,
            output: msg.turnTokens.output,
            cacheRead: msg.turnTokens.cacheRead,
            cacheCreate: msg.turnTokens.cacheCreate,
          });
          setSessionTotal(msg.sessionTotal);
          return;
        }
        case "pong":
          return;
        case "term_output":
          for (const l of termListenersRef.current) l({ kind: "output", data: msg.data });
          return;
        case "term_event":
          for (const l of termListenersRef.current) l({ kind: "event", event: msg.event, exitCode: msg.exitCode, message: msg.message });
          return;
      }
    }
  }, [token, setStatus, setSdkSessionId, setThinking, setRateLimit, setLastTurn, setSessionTotal, pushPermission]);

  /** Auto-attach whenever the active UI session changes. */
  useEffect(() => {
    if (!activeSessionId) return;
    if (wsStatus !== "open") return;
    attach(activeSessionId, null);
  }, [activeSessionId, wsStatus, attach]);

  return useMemo(
    () => ({ wsStatus, startTurn, interrupt, setPermissionMode, setModel, decidePermission, attach,
              termOpen, termInput, termResize, termClose, onTerm }),
    [wsStatus, startTurn, interrupt, setPermissionMode, setModel, decidePermission, attach,
     termOpen, termInput, termResize, termClose, onTerm],
  );
}

export type AgentSocketApi = ReturnType<typeof useAgentSocket>;
