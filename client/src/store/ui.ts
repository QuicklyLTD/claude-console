import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface UiState {
  theme: Theme;
  quietMode: boolean;
  showFileHistory: boolean;
  showSettings: boolean;
  showSessionPicker: boolean;
  sidebarOpen: boolean;
  terminalOpen: boolean;
  setTheme: (t: Theme) => void;
  toggleQuiet: () => void;
  setShowFileHistory: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowSessionPicker: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setTerminalOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      quietMode: true,
      showFileHistory: false,
      showSettings: false,
      showSessionPicker: false,
      sidebarOpen: true,
      terminalOpen: false,
      setTheme: (t) => {
        document.documentElement.classList.toggle("dark", t === "dark");
        set({ theme: t });
      },
      toggleQuiet: () => set((s) => ({ quietMode: !s.quietMode })),
      setShowFileHistory: (v) => set({ showFileHistory: v }),
      setShowSettings: (v) => set({ showSettings: v }),
      setShowSessionPicker: (v) => set({ showSessionPicker: v }),
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      setTerminalOpen: (v) => set({ terminalOpen: v }),
    }),
    {
      name: "claude-console:ui",
      partialize: (s) => ({ theme: s.theme, quietMode: s.quietMode, sidebarOpen: s.sidebarOpen, terminalOpen: s.terminalOpen }),
    },
  ),
);
