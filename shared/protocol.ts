/**
 * Wire protocol between the Claude Console client and server.
 *
 * Both sides import from this file via TS path aliases. Runtime-wise it
 * compiles down to type-only imports — no shared runtime code ships.
 */

import type {
  SDKMessage,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Options,
} from "@anthropic-ai/claude-agent-sdk";

/* -------------------------------------------------------------------------- */
/*  Session metadata (stored in server-side SQLite, mirrors UI state)         */
/* -------------------------------------------------------------------------- */

export interface UISessionMeta {
  /** UUID that matches the SDK session id once the agent starts. Null until started. */
  sdkSessionId: string | null;
  /** Human-assigned or auto-derived title. */
  title: string;
  /** Working directory the agent runs from. */
  workingDir: string | null;
  /** Additional allowed directories beyond cwd. */
  additionalDirectories: string[];
  /** Model alias or full id. */
  model: string | null;
  /** Current permission mode. */
  permissionMode: PermissionMode;
  /** Extra text appended to the default Claude Code system prompt. */
  systemPromptAppend: string | null;
  /** Hard cap on agentic turns per /send. Null = unlimited. */
  maxTurns: number | null;
  /** Tags for filtering / grouping in the sidebar. */
  tags: string[];
  /** Pinned sessions float to the top of the sidebar. */
  pinned: boolean;
  /** Color hint for the avatar (hex or tailwind token). */
  color: string | null;
  /** When this UI session was first created. */
  createdAt: number;
  /** Updated on every message or metadata change. */
  updatedAt: number;
  /** Running total of USD cost across all turns. */
  totalCostUsd: number;
  /** Running total of turns. */
  totalTurns: number;
  /** Running total of output tokens. */
  totalOutputTokens: number;
}

export interface UISessionRow extends UISessionMeta {
  id: string; // internal UI id (nanoid) — separate from sdkSessionId
}

/* -------------------------------------------------------------------------- */
/*  WS client → server messages                                                */
/* -------------------------------------------------------------------------- */

export type ClientMessage =
  /** Start / re-attach to a UI session. */
  | {
      kind: "attach";
      uiSessionId: string;
      /** If present, resume an existing SDK session id. */
      resumeSdkSessionId?: string | null;
    }
  /** User prompt for the current turn. */
  | {
      kind: "send";
      text: string;
      /**
       * Optional attachments — image/document/file bytes as base64.
       * Images are forwarded to the SDK as native image content blocks so the
       * model can actually see them. Text attachments are inlined into the
       * prompt by the server as additional text blocks.
       */
      attachments?: PromptAttachment[];
      /** Optional local id for message round-trip debugging. */
      clientMessageId?: string;
    }
  /** Answer to an outstanding canUseTool prompt. */
  | {
      kind: "permission_decision";
      requestId: string;
      decision: PermissionDecisionPayload;
    }
  /** Cancel the in-flight turn. */
  | { kind: "interrupt" }
  /** Live switch: permission mode. */
  | { kind: "set_permission_mode"; mode: PermissionMode }
  /** Live switch: model. */
  | { kind: "set_model"; model: string | null }
  /** Apply flag-layer settings update (rare). */
  | { kind: "apply_settings"; settings: Record<string, unknown> }
  /** Heartbeat ping for connection health. */
  | { kind: "ping"; ts: number }
  /** Open a pty attached to the current session's working directory. */
  | { kind: "term_open"; cols: number; rows: number }
  /** Forward user keystrokes to the pty. */
  | { kind: "term_input"; data: string }
  /** Resize the pty. */
  | { kind: "term_resize"; cols: number; rows: number }
  /** Close the pty. */
  | { kind: "term_close" };

export interface PromptAttachment {
  kind: "image" | "text" | "file";
  name: string;
  /** MIME type — used both for protocol routing and SDK media_type. */
  mimeType: string;
  /**
   * Base64 payload. For text attachments this is the plain UTF-8 text (no
   * base64) — see `encoding` discriminator.
   */
  data: string;
  /** "base64" for binary; "utf8" for inline text. */
  encoding: "base64" | "utf8";
}

export interface PermissionDecisionPayload {
  behavior: "allow" | "deny";
  /** For allow: optional override of tool input. */
  updatedInput?: Record<string, unknown>;
  /** For deny: a reason string surfaced back to the model. */
  message?: string;
  /** Persistence scope for the decision. */
  scope: "once" | "session" | "project" | "user";
  /** Full set of suggestions the UI elected to accept (project/user scope). */
  updatedPermissions?: PermissionUpdate[];
}

/* -------------------------------------------------------------------------- */
/*  WS server → client messages                                                */
/* -------------------------------------------------------------------------- */

export type ServerMessage =
  /** Bridge-level signal (not from the SDK). */
  | {
      kind: "bridge";
      event:
        | "attached"
        | "started"
        | "ended"
        | "interrupted"
        | "error"
        | "stderr"
        | "reconnect_replay_start"
        | "reconnect_replay_end";
      uiSessionId?: string;
      sdkSessionId?: string | null;
      message?: string;
      /** Monotonic seq this message carries. */
      seq: number;
    }
  /** Raw SDKMessage, forwarded with a seq number. */
  | {
      kind: "sdk";
      message: SDKMessage;
      seq: number;
    }
  /** canUseTool callback — waiting on `permission_decision` from client. */
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
      suggestions?: PermissionUpdate[];
      seq: number;
    }
  /** Running cost + usage after a `result` SDK message, merged with session meta. */
  | {
      kind: "cost_update";
      uiSessionId: string;
      turnCostUsd: number;
      turnDurationMs: number;
      turnTokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
      sessionTotal: { costUsd: number; turns: number; outputTokens: number };
      seq: number;
    }
  /** Heartbeat pong. */
  | { kind: "pong"; ts: number; seq: number }
  /** PTY output chunk. */
  | { kind: "term_output"; data: string; seq: number }
  /** PTY lifecycle events (open ok, exit, error). */
  | { kind: "term_event"; event: "opened" | "exited" | "error"; exitCode?: number; message?: string; seq: number };

/* -------------------------------------------------------------------------- */
/*  REST DTOs                                                                  */
/* -------------------------------------------------------------------------- */

export interface ConfigDTO {
  defaults: {
    cwd: string | null;
    model: string | null;
    permissionMode: PermissionMode;
    additionalDirectories: string[];
    maxTurns: number | null;
  };
  authRequired: boolean;
  version: string;
}

export interface CreateSessionRequest
  extends Partial<
    Omit<
      UISessionMeta,
      "createdAt" | "updatedAt" | "totalCostUsd" | "totalTurns" | "totalOutputTokens" | "sdkSessionId"
    >
  > {}

export interface SessionListItem extends UISessionRow {}

export interface SessionDetail {
  session: UISessionRow;
  /** Raw SDK JSONL messages if the SDK session exists on disk. */
  sdkMessages: SDKMessage[] | null;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export type AnyOptions = Options;

export const DEFAULT_PERMISSION_MODE: PermissionMode = "default";

export function isServerMessage(v: unknown): v is ServerMessage {
  return !!v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string";
}
export function isClientMessage(v: unknown): v is ClientMessage {
  return !!v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string";
}
