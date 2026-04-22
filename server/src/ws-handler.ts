import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type {
  ClientMessage,
  ServerMessage,
  UISessionRow,
} from "@shared/protocol.js";
import { AgentSession, type AgentEvent } from "./agent-session.js";
import { Terminal } from "./term-handler.js";
import { accumulateUsage, getUiSession, patchUiSession } from "./db.js";
import { errorLog } from "./logger.js";

/* ---------------- Client message runtime schemas ------------------------- */

const PermissionMode = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);

const PermissionDecision = z.object({
  behavior: z.enum(["allow", "deny"]),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
  message: z.string().max(4000).optional(),
  scope: z.enum(["once", "session", "project", "user"]),
  updatedPermissions: z.array(z.unknown()).optional(),
});

const ClientMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attach"),
    uiSessionId: z.string().min(1).max(100),
    resumeSdkSessionId: z.string().max(100).nullish(),
  }),
  z.object({
    kind: z.literal("send"),
    text: z.string().min(1).max(100_000),
    attachments: z
      .array(
        z.object({
          kind: z.enum(["image", "text", "file"]),
          name: z.string().max(300),
          mimeType: z.string().max(120),
          // 10 MB base64 cap per attachment (~7.5 MB raw).
          data: z.string().max(10_500_000),
          encoding: z.enum(["base64", "utf8"]),
        }),
      )
      .max(10)
      .optional(),
    clientMessageId: z.string().max(100).optional(),
  }),
  z.object({
    kind: z.literal("permission_decision"),
    requestId: z.string().min(1).max(100),
    decision: PermissionDecision,
  }),
  z.object({ kind: z.literal("interrupt") }),
  z.object({ kind: z.literal("set_permission_mode"), mode: PermissionMode }),
  z.object({ kind: z.literal("set_model"), model: z.string().max(100).nullable() }),
  z.object({ kind: z.literal("apply_settings"), settings: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("ping"), ts: z.number() }),
  z.object({ kind: z.literal("term_open"), cols: z.number().int(), rows: z.number().int() }),
  z.object({ kind: z.literal("term_input"), data: z.string().max(1_000_000) }),
  z.object({ kind: z.literal("term_resize"), cols: z.number().int(), rows: z.number().int() }),
  z.object({ kind: z.literal("term_close") }),
]);

const log = errorLog("ws");

/**
 * Server-lifetime buffer of recent frames keyed by uiSessionId. Survives WS
 * close → new connect. When the client reconnects and re-attaches to the same
 * uiSessionId with ?fromSeq=N, the handler replays everything after N.
 *
 * Capped per-session to avoid unbounded growth.
 */
const REPLAY_BUFFER_MAX_PER_SESSION = 500;
const sessionReplay = new Map<string, Array<{ seq: number; frame: ServerMessage }>>();

function recordFrame(uiSessionId: string | null, frame: ServerMessage): void {
  if (!uiSessionId) return;
  let list = sessionReplay.get(uiSessionId);
  if (!list) {
    list = [];
    sessionReplay.set(uiSessionId, list);
  }
  list.push({ seq: frame.seq, frame });
  if (list.length > REPLAY_BUFFER_MAX_PER_SESSION) list.shift();
}

function framesSince(uiSessionId: string, fromSeq: number): ServerMessage[] {
  const list = sessionReplay.get(uiSessionId);
  if (!list) return [];
  return list.filter((e) => e.seq > fromSeq).map((e) => e.frame);
}

export function dropReplayForSession(uiSessionId: string): void {
  sessionReplay.delete(uiSessionId);
}

interface ConnState {
  ws: WebSocket;
  agent: AgentSession | null;
  uiSessionId: string | null;
  /**
   * Monotonic seq counter PER uiSessionId. Stored on the connection but
   * re-seeded from `sessionReplay` on attach so reconnects continue counting.
   */
  seq: number;
  alive: boolean;
  /** Set once the close handler fires — attach() must abandon its newly
   * constructed agent if it finds this flag on return from start(). */
  closed: boolean;
  /** `?fromSeq=N` from the initial WS upgrade URL; honored on first attach. */
  initialFromSeq: number;
  attachChain: Promise<void>;
  currentAttachUiId: string | null;
  /** Terminal tied to this connection (shares lifetime with the WS). */
  term: Terminal | null;
}

export function attachWs(wss: WebSocketServer): void {
  wss.on("connection", (ws, req) => {
    const state: ConnState = {
      ws,
      agent: null,
      uiSessionId: null,
      seq: 0,
      alive: true,
      closed: false,
      initialFromSeq: 0,
      attachChain: Promise.resolve(),
      currentAttachUiId: null,
      term: null,
    };

    log.info({ ip: remoteIp(req) }, "ws connected");
    const heartbeat = setInterval(() => {
      if (!state.alive) {
        try { ws.terminate(); } catch { /* noop */ }
        return;
      }
      state.alive = false;
      try { ws.ping(); } catch { /* noop */ }
    }, 25_000);

    ws.on("pong", () => { state.alive = true; });

    ws.on("message", (raw) => void handleMessage(state, raw.toString()));
    ws.on("close", async () => {
      clearInterval(heartbeat);
      state.closed = true;
      // Poison the attach guard so any in-flight attach abandons its new agent.
      state.currentAttachUiId = null;
      // Drain pending attach chain before stopping the (possibly just-set) agent.
      try { await state.attachChain; } catch { /* already surfaced */ }
      if (state.agent) await state.agent.stop();
      if (state.term) { state.term.close(); state.term = null; }
      log.info("ws closed");
    });
    ws.on("error", (err) => log.warn({ err: String(err) }, "ws error"));

    // Read ?fromSeq=N once from the upgrade URL. Used on the next attach
    // to replay frames the client missed since that sequence number.
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const fromSeq = Number(url.searchParams.get("fromSeq"));
      if (Number.isFinite(fromSeq) && fromSeq > 0) state.initialFromSeq = fromSeq;
    } catch { /* noop */ }
  });
}

async function handleMessage(state: ConnState, raw: string): Promise<void> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch {
    return sendBridgeError(state, "invalid JSON");
  }
  const result = ClientMessageSchema.safeParse(parsed);
  if (!result.success) {
    return sendBridgeError(state, `invalid message: ${result.error.issues[0]?.message ?? "unknown"}`);
  }
  const msg: ClientMessage = result.data as ClientMessage;

  switch (msg.kind) {
    case "attach":
      // Chain every attach onto the previous promise so two rapid attaches
      // can never overlap — no two AgentSessions can be alive at once.
      state.attachChain = state.attachChain.then(
        () => attach(state, msg.uiSessionId, msg.resumeSdkSessionId ?? null),
        (err) => {
          log.warn({ err: String(err) }, "prior attach chain rejected");
          return attach(state, msg.uiSessionId, msg.resumeSdkSessionId ?? null);
        },
      );
      return;
    case "send":
      if (!state.agent) return sendBridgeError(state, "no agent attached");
      state.agent.pushPrompt(msg.text, msg.attachments);
      return;
    case "permission_decision":
      state.agent?.resolvePermission(msg.requestId, msg.decision);
      return;
    case "interrupt":
      try { await state.agent?.interrupt(); }
      catch (err) { return sendBridgeError(state, `interrupt: ${extractMessage(err)}`); }
      return;
    case "set_permission_mode":
      try {
        await state.agent?.setPermissionMode(msg.mode);
        if (state.uiSessionId) patchUiSession(state.uiSessionId, { permissionMode: msg.mode });
      } catch (err) {
        // Runtime switch to `bypassPermissions` is rejected by the SDK because
        // the underlying process wasn't launched with --dangerously-skip-permissions.
        // Workaround: persist the new mode and restart the agent (resume keeps
        // the conversation intact).
        if (msg.mode === "bypassPermissions" && state.uiSessionId && state.agent) {
          const uiId = state.uiSessionId;
          const resume = state.agent.sdkSessionId;
          patchUiSession(uiId, { permissionMode: msg.mode });
          log.info({ uiSessionId: uiId, resume }, "restarting agent to apply bypassPermissions");
          await attach(state, uiId, resume);
          return;
        }
        return sendBridgeError(state, `set_permission_mode: ${extractMessage(err)}`);
      }
      return;
    case "set_model":
      try {
        await state.agent?.setModel(msg.model);
        if (state.uiSessionId) patchUiSession(state.uiSessionId, { model: msg.model });
      } catch (err) { return sendBridgeError(state, `set_model: ${extractMessage(err)}`); }
      return;
    case "apply_settings":
      if (!isPlainObject(msg.settings)) {
        return sendBridgeError(state, "apply_settings: expected JSON object");
      }
      try { await state.agent?.applyFlagSettings(msg.settings); }
      catch (err) { return sendBridgeError(state, `apply_settings: ${extractMessage(err)}`); }
      return;
    case "ping":
      return send(state, { kind: "pong", ts: msg.ts, seq: 0 /* overwritten */ });
    case "term_open": {
      // Reuse if already open — just resize.
      if (state.term) { state.term.resize(msg.cols, msg.rows); return; }
      const cwd = state.uiSessionId ? getUiSession(state.uiSessionId)?.workingDir ?? null : null;
      state.term = new Terminal({
        cwd,
        cols: msg.cols,
        rows: msg.rows,
        sink: {
          onOutput: (data) => send(state, { kind: "term_output", data, seq: 0 }),
          onEvent: (event, opts) =>
            send(state, { kind: "term_event", event, exitCode: opts?.exitCode, message: opts?.message, seq: 0 }),
        },
      });
      state.term.start();
      return;
    }
    case "term_input":
      state.term?.write(msg.data);
      return;
    case "term_resize":
      state.term?.resize(msg.cols, msg.rows);
      return;
    case "term_close":
      state.term?.close();
      state.term = null;
      return;
    default: {
      const exhaustive: never = msg;
      void exhaustive;
      return sendBridgeError(state, "unknown kind");
    }
  }
}

async function attach(state: ConnState, uiSessionId: string, resumeSdkSessionId: string | null): Promise<void> {
  // If the connection already closed (raced with us), do nothing.
  if (state.closed) return;

  const session = getUiSession(uiSessionId);
  if (!session) {
    // Consume fromSeq only after confirming session exists (keeps client
    // retry semantics intact if the session is temporarily missing).
    return sendBridgeError(state, "ui session not found");
  }

  // Mark the intent BEFORE doing any awaited work so concurrent sink events
  // from the previous AgentSession can be filtered out.
  state.currentAttachUiId = uiSessionId;

  if (state.agent) await state.agent.stop();
  state.uiSessionId = uiSessionId;
  state.agent = null;

  // Resume seq counter from the persisted buffer.
  const persisted = sessionReplay.get(uiSessionId);
  state.seq = persisted && persisted.length ? persisted[persisted.length - 1]!.seq : 0;

  // Replay any frames the client missed.
  const fromSeq = state.initialFromSeq;
  state.initialFromSeq = 0;
  const replay = fromSeq > 0 ? framesSince(uiSessionId, fromSeq) : [];
  if (replay.length > 0) {
    send(state, { kind: "bridge", event: "reconnect_replay_start", seq: 0 });
    for (const frame of replay) {
      // Guard each send — socket may close mid-replay.
      if (state.ws.readyState !== WebSocket.OPEN) break;
      try { state.ws.send(JSON.stringify(frame)); }
      catch (err) { log.warn({ err: String(err) }, "replay send failed"); break; }
    }
    send(state, { kind: "bridge", event: "reconnect_replay_end", seq: 0 });
  }

  send(state, { kind: "bridge", event: "attached", uiSessionId, sdkSessionId: session.sdkSessionId, seq: 0 });

  const agent = new AgentSession({
    session,
    resumeSdkSessionId,
    sink: (e) => {
      // Drop events from agents whose session is no longer current.
      if (state.currentAttachUiId !== uiSessionId) return;
      void routeAgentEvent(state, session, e);
    },
  });
  try {
    await agent.start();
    // If another attach began, or the connection closed, during start(): abandon.
    if (state.closed || state.currentAttachUiId !== uiSessionId) {
      await agent.stop();
      return;
    }
    state.agent = agent;
    send(state, { kind: "bridge", event: "started", uiSessionId, sdkSessionId: agent.sdkSessionId, seq: 0 });
  } catch (err) {
    sendBridgeError(state, extractMessage(err));
  }
}

async function routeAgentEvent(state: ConnState, session: UISessionRow, e: AgentEvent): Promise<void> {
  switch (e.kind) {
    case "sdk": {
      const m = e.message;

      // Persist sdk_session_id (and cwd if not yet set) on first system/init —
      // this is the canonical mapping we need later to re-fetch the SDK JSONL
      // transcript for session rehydration.
      if (m.type === "system" && m.subtype === "init" && m.session_id) {
        const initMsg = m as { session_id: string; cwd?: string };
        const patch: Parameters<typeof patchUiSession>[1] = { sdkSessionId: initMsg.session_id };
        if (!session.workingDir && initMsg.cwd) patch.workingDir = initMsg.cwd;
        patchUiSession(session.id, patch);
      }

      // Accumulate usage on result.
      if (m.type === "result" && "total_cost_usd" in m) {
        const r = m as { total_cost_usd: number; num_turns: number; duration_ms: number; usage?: {
          input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
        }; session_id: string };
        const updated = accumulateUsage(session.id, {
          costUsd: r.total_cost_usd,
          turns: 1,
          outputTokens: r.usage?.output_tokens ?? 0,
          sdkSessionId: r.session_id ?? null,
        });
        if (updated) {
          send(state, {
            kind: "cost_update",
            uiSessionId: session.id,
            turnCostUsd: r.total_cost_usd,
            turnDurationMs: r.duration_ms,
            turnTokens: {
              input: r.usage?.input_tokens ?? 0,
              output: r.usage?.output_tokens ?? 0,
              cacheRead: r.usage?.cache_read_input_tokens ?? 0,
              cacheCreate: r.usage?.cache_creation_input_tokens ?? 0,
            },
            sessionTotal: {
              costUsd: updated.totalCostUsd,
              turns: updated.totalTurns,
              outputTokens: updated.totalOutputTokens,
            },
            seq: 0,
          });
        }
      }

      send(state, { kind: "sdk", message: m, seq: 0 });
      return;
    }
    case "permission_request":
      return send(state, {
        kind: "permission_request",
        requestId: e.requestId,
        toolName: e.toolName,
        toolUseID: e.toolUseID,
        agentID: e.agentID,
        input: e.input,
        title: e.title,
        displayName: e.displayName,
        description: e.description,
        decisionReason: e.decisionReason,
        blockedPath: e.blockedPath,
        suggestions: e.suggestions as never,
        seq: 0,
      });
    case "stderr":
      return send(state, { kind: "bridge", event: "stderr", message: e.message, seq: 0 });
    case "bridge_ended":
      return send(state, {
        kind: "bridge",
        event: e.interrupted ? "interrupted" : "ended",
        seq: 0,
      });
    case "bridge_error":
      return send(state, { kind: "bridge", event: "error", message: e.message, seq: 0 });
  }
}

function send(state: ConnState, msg: ServerMessage): void {
  if (state.ws.readyState !== WebSocket.OPEN) return;
  state.seq += 1;
  const framed = { ...msg, seq: state.seq } as ServerMessage;
  // Record into the server-lifetime replay buffer so a reconnect can replay
  // frames the client missed. Keyed by uiSessionId; only frames belonging to
  // an attached session are buffered. Skip high-volume terminal output —
  // the pty itself is closed on disconnect; replaying old bytes is useless.
  if (framed.kind !== "term_output" && framed.kind !== "term_event") {
    recordFrame(state.uiSessionId, framed);
  }
  try { state.ws.send(JSON.stringify(framed)); }
  catch (err) { log.warn({ err: String(err) }, "ws send failed"); }
}

function sendBridgeError(state: ConnState, message: string): void {
  send(state, { kind: "bridge", event: "error", message, seq: 0 });
}

function extractMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function remoteIp(req: IncomingMessage): string {
  return (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
