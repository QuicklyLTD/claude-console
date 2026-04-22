import { create } from "zustand";
import type { UISessionRow } from "@shared/protocol";

export type BridgeStatus = "idle" | "connecting" | "attached" | "running" | "interrupted" | "error";

export interface TurnUsage {
  turnCostUsd: number;
  durationMs: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

interface SessionState {
  /** List of UI sessions (from /api/sessions). */
  sessions: UISessionRow[];
  /** Currently active UI session id. */
  activeSessionId: string | null;
  /** SDK session id (populated on system/init). */
  sdkSessionId: string | null;
  /** Bridge/agent status. */
  status: BridgeStatus;
  /** Latest assistant "thinking" signal (from status requesting). */
  thinking: boolean;
  /** Last turn usage. */
  lastTurn: TurnUsage | null;
  /** Rate-limit info mirror. */
  rateLimit: { status: string; resetsAt: number | null; rateLimitType: string | null } | null;
  /** Active session total (mirrored from server). */
  sessionTotal: { costUsd: number; turns: number; outputTokens: number };
  /** Model list (populated from query.supportedModels()). */
  availableModels: Array<{ id: string; name?: string; description?: string }>;

  setSessions: (rows: UISessionRow[]) => void;
  upsertSession: (row: UISessionRow) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  setSdkSessionId: (id: string | null) => void;
  setStatus: (status: BridgeStatus) => void;
  setThinking: (v: boolean) => void;
  setLastTurn: (u: TurnUsage | null) => void;
  setRateLimit: (v: SessionState["rateLimit"]) => void;
  setSessionTotal: (t: SessionState["sessionTotal"]) => void;
  setAvailableModels: (m: SessionState["availableModels"]) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  sdkSessionId: null,
  status: "idle",
  thinking: false,
  lastTurn: null,
  rateLimit: null,
  sessionTotal: { costUsd: 0, turns: 0, outputTokens: 0 },
  availableModels: [],

  setSessions: (rows) => set({ sessions: rows }),
  upsertSession: (row) =>
    set((s) => {
      const existing = s.sessions.find((x) => x.id === row.id);
      const next = existing
        ? s.sessions.map((x) => (x.id === row.id ? row : x))
        : [row, ...s.sessions];
      return { sessions: next };
    }),
  removeSession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setSdkSessionId: (id) => set({ sdkSessionId: id }),
  setStatus: (status) => set({ status }),
  setThinking: (v) => set({ thinking: v }),
  setLastTurn: (u) => set({ lastTurn: u }),
  setRateLimit: (v) => set({ rateLimit: v }),
  setSessionTotal: (t) => set({ sessionTotal: t }),
  setAvailableModels: (m) => set({ availableModels: m }),
  reset: () =>
    set({
      sdkSessionId: null,
      status: "idle",
      thinking: false,
      lastTurn: null,
      rateLimit: null,
      sessionTotal: { costUsd: 0, turns: 0, outputTokens: 0 },
    }),
}));
