import { useEffect } from "react";
import { useUiStore } from "@/store/ui";
import { usePermissionStore } from "@/store/permission";

interface Handlers {
  newSession: () => void;
  interrupt: () => void;
}

/**
 * Global keyboard shortcuts. Ignores when focus is inside an editable control
 * unless the shortcut explicitly opts into that.
 */
export function useKeyboardShortcuts(h: Handlers): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      // Cmd+K — session picker
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        useUiStore.getState().setShowSessionPicker(true);
        return;
      }
      // Cmd+N — new session
      if (mod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        h.newSession();
        return;
      }
      // Cmd+, — settings
      if (mod && e.key === ",") {
        e.preventDefault();
        useUiStore.getState().setShowSettings(true);
        return;
      }
      // Cmd+\ — toggle sidebar
      if (mod && e.key === "\\") {
        e.preventDefault();
        useUiStore.getState().setSidebarOpen(!useUiStore.getState().sidebarOpen);
        return;
      }
      // Cmd+J — toggle terminal panel
      if (mod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        useUiStore.getState().setTerminalOpen(!useUiStore.getState().terminalOpen);
        return;
      }
      // Esc — close the topmost modal (stack order), else interrupt turn.
      // If a PermissionDialog is open, skip entirely — Radix Dialog handles
      // Escape via its onOpenChange, and we don't want to simultaneously
      // interrupt the agent turn while the dialog is closing.
      if (e.key === "Escape" && !inInput) {
        if (usePermissionStore.getState().permissionQueue.length > 0) return;
        const ui = useUiStore.getState();
        if (ui.showSessionPicker) { ui.setShowSessionPicker(false); return; }
        if (ui.showFileHistory)   { ui.setShowFileHistory(false); return; }
        if (ui.showSettings)      { ui.setShowSettings(false); return; }
        h.interrupt();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [h]);
}
