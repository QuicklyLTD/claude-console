import { randomUUID } from "node:crypto";
import {
  query,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
  type Query,
  type Settings,
} from "@anthropic-ai/claude-agent-sdk";
import type { PermissionDecisionPayload, PromptAttachment, UISessionRow } from "@shared/protocol.js";
import { PushableQueue } from "./pushable-queue.js";
import { errorLog } from "./logger.js";

const log = errorLog("agent-session");

export type AgentEvent =
  | { kind: "sdk"; message: SDKMessage }
  | { kind: "stderr"; message: string }
  | { kind: "bridge_error"; message: string }
  | { kind: "bridge_ended"; interrupted: boolean }
  | {
      kind: "permission_request";
      requestId: string;
      toolName: string;
      toolUseID: string;
      agentID?: string;
      input: Record<string, unknown>;
      title?: string;
      displayName?: string;
      description?: string;
      decisionReason?: string;
      blockedPath?: string;
      suggestions?: unknown[];
    };

export type AgentEventSink = (event: AgentEvent) => void;

export interface AgentStartArgs {
  session: UISessionRow;
  /** Optional: override resume id; otherwise uses session.sdkSessionId. */
  resumeSdkSessionId?: string | null;
  sink: AgentEventSink;
}

/**
 * Owns the SDK `query()` lifecycle for one UI session. Streaming input via
 * PushableQueue — the same query() lives across every user turn, so prompt
 * caches stay warm and control-request methods (interrupt, setPermissionMode,
 * setModel) are available.
 */
export class AgentSession {
  readonly uiSessionId: string;
  #args: AgentStartArgs;
  #sink: AgentEventSink;
  #inputQueue: PushableQueue<SDKUserMessage> | null = null;
  #query: Query | null = null;
  #abort: AbortController | null = null;
  #pendingPermissions = new Map<string, PendingPermissionEntry>();
  #closed = false;
  /** When true, skip opening canUseTool for this tool name for the rest of the session. */
  #sessionAllow = new Set<string>();
  #runLoop: Promise<void> | null = null;
  #sdkSessionId: string | null = null;

  constructor(args: AgentStartArgs) {
    this.#args = args;
    this.#sink = args.sink;
    this.uiSessionId = args.session.id;
  }

  get sdkSessionId(): string | null {
    return this.#sdkSessionId;
  }

  async start(): Promise<void> {
    if (this.#query) throw new Error("already started");
    const s = this.#args.session;
    this.#inputQueue = new PushableQueue<SDKUserMessage>();
    this.#abort = new AbortController();

    const options: Options = {
      cwd: s.workingDir ?? undefined,
      model: s.model ?? undefined,
      permissionMode: s.permissionMode,
      additionalDirectories: s.additionalDirectories.length ? s.additionalDirectories : undefined,
      maxTurns: s.maxTurns ?? undefined,
      includePartialMessages: true,
      abortController: this.#abort,
      canUseTool: (name, input, ctx) => this.#askPermission(name, input, ctx),
      stderr: (line) => this.#sink({ kind: "stderr", message: line }),
    };
    if (s.systemPromptAppend) {
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: s.systemPromptAppend,
      };
    }
    const resume = this.#args.resumeSdkSessionId ?? s.sdkSessionId;
    if (resume) options.resume = resume;

    log.info({ uiSessionId: s.id, cwd: s.workingDir, model: s.model, resume }, "starting query");

    try {
      this.#query = query({ prompt: this.#inputQueue, options });
    } catch (err) {
      this.#sink({ kind: "bridge_error", message: extractErrorMessage(err) });
      throw err;
    }

    this.#runLoop = this.#drain();
  }

  pushPrompt(text: string, attachments?: PromptAttachment[]): void {
    if (!this.#inputQueue) {
      this.#sink({ kind: "bridge_error", message: "agent not started" });
      return;
    }
    // Build SDK content blocks: text first, then each attachment as the
    // appropriate native block type so the model can actually perceive it.
    // - Images → image block (base64 source, SDK-supported media types).
    // - Text   → inline text block with filename header.
    // - Other  → text block with placeholder (SDK doesn't accept arbitrary files).
    type Block =
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
        }
      | {
          type: "document";
          source: { type: "base64"; media_type: "application/pdf"; data: string };
          title?: string;
        };
    const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

    const blocks: Block[] = [{ type: "text", text }];
    for (const att of attachments ?? []) {
      if (att.kind === "image" && IMAGE_TYPES.has(att.mimeType) && att.encoding === "base64") {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: att.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: att.data,
          },
        });
      } else if (att.kind === "file" && att.mimeType === "application/pdf" && att.encoding === "base64") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: att.data },
          title: att.name,
        });
      } else if (att.kind === "text" && att.encoding === "utf8") {
        blocks.push({ type: "text", text: `\n\n[attached file: ${att.name}]\n${att.data}` });
      } else {
        // Unsupported combo — keep a marker so the user sees we tried.
        blocks.push({ type: "text", text: `\n\n[attached ${att.kind}: ${att.name} (${att.mimeType}) — not forwarded to model]` });
      }
    }

    // Note: session_id is optional on SDKUserMessage; omit it entirely until
    // the SDK emits the system/init that establishes the real id. Sending an
    // empty string here would be interpreted as a different, invalid session.
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: blocks },
      parent_tool_use_id: null,
      ...(this.#sdkSessionId ? { session_id: this.#sdkSessionId } : {}),
    };
    this.#inputQueue.push(msg);
  }

  async interrupt(): Promise<void> {
    if (!this.#query) return;
    try { await this.#query.interrupt(); }
    catch (err) { log.warn({ err: extractErrorMessage(err) }, "interrupt failed"); }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.#query) return;
    await this.#query.setPermissionMode(mode);
  }
  async setModel(model: string | null | undefined): Promise<void> {
    if (!this.#query) return;
    await this.#query.setModel(model ?? undefined);
  }
  async applyFlagSettings(settings: Record<string, unknown>): Promise<void> {
    if (!this.#query) return;
    // Settings is an open-shape interface on the SDK side; we accept a
    // plain object and delegate validation to the SDK. The WS layer
    // pre-validates it's a JSON object (non-array, non-null).
    await this.#query.applyFlagSettings(settings as Settings);
  }

  resolvePermission(requestId: string, decision: PermissionDecisionPayload): void {
    const entry = this.#pendingPermissions.get(requestId);
    if (!entry) return;
    this.#pendingPermissions.delete(requestId);

    if (decision.behavior === "deny") {
      entry.resolve({ behavior: "deny", message: decision.message || "User denied" });
      return;
    }
    // allow — store session-scope if requested, then resolve.
    // SDK's allow-branch schema requires `updatedInput`; default to the
    // original tool input when the UI didn't override it.
    const result: PermissionResult = {
      behavior: "allow",
      updatedInput: decision.updatedInput ?? entry.input,
    };
    if (decision.scope === "session" && entry.toolName) {
      this.#sessionAllow.add(entry.toolName);
    }
    if ((decision.scope === "project" || decision.scope === "user") && decision.updatedPermissions) {
      result.updatedPermissions = decision.updatedPermissions;
    }
    entry.resolve(result);
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    // Deny all outstanding permission prompts first.
    for (const [id, entry] of this.#pendingPermissions) {
      entry.resolve({ behavior: "deny", message: "session closed" });
      this.#pendingPermissions.delete(id);
    }
    this.#inputQueue?.close();
    try { this.#abort?.abort(); } catch { /* noop */ }
    try { await this.#runLoop; } catch { /* already surfaced */ }
    this.#query = null;
  }

  async #drain(): Promise<void> {
    if (!this.#query) return;
    try {
      for await (const msg of this.#query) {
        if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
          this.#sdkSessionId = msg.session_id;
        }
        this.#sink({ kind: "sdk", message: msg });
      }
      this.#sink({ kind: "bridge_ended", interrupted: false });
    } catch (err) {
      const msg = extractErrorMessage(err);
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || /aborted by user/i.test(msg) || this.#abort?.signal.aborted);
      if (aborted) this.#sink({ kind: "bridge_ended", interrupted: true });
      else this.#sink({ kind: "bridge_error", message: msg });
      log.error({ err: msg, aborted }, "query loop ended");
    }
  }

  #askPermission(
    toolName: string,
    input: Record<string, unknown>,
    ctx: Parameters<NonNullable<Options["canUseTool"]>>[2],
  ): Promise<PermissionResult> {
    if (this.#sessionAllow.has(toolName)) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    return new Promise<PermissionResult>((resolve) => {
      const requestId = randomUUID();
      this.#pendingPermissions.set(requestId, { resolve, toolName, input });

      this.#sink({
        kind: "permission_request",
        requestId,
        toolName,
        toolUseID: ctx.toolUseID,
        agentID: ctx.agentID,
        input,
        title: ctx.title,
        displayName: ctx.displayName,
        description: ctx.description,
        decisionReason: ctx.decisionReason,
        blockedPath: ctx.blockedPath,
        suggestions: ctx.suggestions as unknown[] | undefined,
      });

      // `{ once: true }` auto-removes the listener after it fires so we don't
      // accumulate listeners on ctx.signal across many tool calls.
      ctx.signal.addEventListener(
        "abort",
        () => {
          const entry = this.#pendingPermissions.get(requestId);
          if (entry) {
            this.#pendingPermissions.delete(requestId);
            entry.resolve({ behavior: "deny", message: "aborted" });
          }
        },
        { once: true },
      );
    });
  }
}

interface PendingPermissionEntry {
  resolve: (r: PermissionResult) => void;
  toolName: string;
  input: Record<string, unknown>;
}

function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}
