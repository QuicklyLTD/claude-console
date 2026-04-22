import { create } from "zustand";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export interface PendingPermission {
  requestId: string;
  toolName: string;
  toolUseID: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
  suggestions?: PermissionUpdate[];
  receivedAt: number;
}

interface State {
  permissionQueue: PendingPermission[];
  pushPermission: (p: PendingPermission) => void;
  popPermission: (id: string) => void;
  clearAll: () => void;
}

export const usePermissionStore = create<State>((set) => ({
  permissionQueue: [],
  pushPermission: (p) =>
    set((s) => ({ permissionQueue: [...s.permissionQueue, p] })),
  popPermission: (id) =>
    set((s) => ({ permissionQueue: s.permissionQueue.filter((x) => x.requestId !== id) })),
  clearAll: () => set({ permissionQueue: [] }),
}));
