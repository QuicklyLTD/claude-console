import { useCallback, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import { TopBar } from "@/components/TopBar/TopBar";
import { Chat } from "@/components/Chat/Chat";
import { PermissionDialog } from "@/components/Modals/PermissionDialog";
import { SessionPicker } from "@/components/Modals/SessionPicker";
import { SettingsModal } from "@/components/Modals/SettingsModal";
import { FileHistoryPanel } from "@/components/FileHistory/FileHistoryPanel";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { TerminalPanel } from "@/components/Terminal/TerminalPanel";
import { useAgentSocket } from "@/hooks/useAgentSocket";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { api, setApiToken } from "@/lib/api";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOKEN_STORAGE_KEY = "claude-console:token";

/**
 * Read the bridge token exactly once per page load:
 *   1. `?token=...` from the URL (one-time hand-off) → persisted for this tab only
 *   2. sessionStorage (isolated per tab, dropped on close — better than
 *      localStorage which any JS on the origin can read forever)
 *
 * Runs at module init, outside React's render cycle.
 */
const BRIDGE_TOKEN: string | null = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("token");
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
      params.delete("token");
      const cleaned =
        window.location.pathname + (params.toString() ? "?" + params.toString() : "");
      window.history.replaceState(null, "", cleaned);
      return fromUrl;
    }
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
})();

// Propagate to the REST client so every /api/* fetch includes the header.
setApiToken(BRIDGE_TOKEN);

export function App() {
  const theme = useUiStore((s) => s.theme);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const terminalOpen = useUiStore((s) => s.terminalOpen);
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActiveSession);
  const setSessions = useSessionStore((s) => s.setSessions);
  const upsert = useSessionStore((s) => s.upsertSession);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const socket = useAgentSocket(BRIDGE_TOKEN);

  const newSession = useCallback(async () => {
    const { session } = await api.createSession({});
    upsert(session);
    setActive(session.id);
  }, [upsert, setActive]);
  const interrupt = useCallback(() => socket.interrupt(), [socket]);
  const shortcutHandlers = useMemo(
    () => ({ newSession, interrupt }),
    [newSession, interrupt],
  );
  useKeyboardShortcuts(shortcutHandlers);

  useEffect(() => {
    api.listSessions().then((r) => {
      setSessions(r.sessions);
      // Auto-select the most recently updated if none chosen.
      if (!activeId && r.sessions.length > 0 && r.sessions[0]) setActive(r.sessions[0].id);
    }).catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="h-full w-full flex bg-background">
      {sidebarOpen && <Sidebar />}
      <main className="flex-1 min-w-0 flex flex-col">
        {active ? (
          <>
            <TopBar session={active} socket={socket} />
            <StatusStrip />
            <div className="flex-1 min-h-0 flex flex-col">
              <Chat session={active} socket={socket} />
              {terminalOpen && (
                <TerminalPanel
                  key={active.id}
                  socket={socket}
                  sessionId={active.id}
                  cwd={active.workingDir}
                />
              )}
            </div>
          </>
        ) : (
          <NoSession socket={socket} />
        )}
      </main>

      <PermissionDialog socket={socket} />
      <SessionPicker />
      <SettingsModal />
      <FileHistoryPanel />
    </div>
  );
}

function NoSession({ socket }: { socket: ReturnType<typeof useAgentSocket> }) {
  const upsert = useSessionStore((s) => s.upsertSession);
  const setActive = useSessionStore((s) => s.setActiveSession);
  async function create() {
    const { session } = await api.createSession({});
    upsert(session);
    setActive(session.id);
  }
  return (
    <div className={cn("flex-1 grid place-items-center bg-background")}>
      <div className="text-center max-w-sm px-6">
        <div className="mx-auto size-14 rounded-full bg-primary/10 text-primary grid place-items-center mb-6">
          <Sparkles className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Claude Console</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Agent-backed chat over a persistent WebSocket. Every tool call is gated by
          you, every turn is cost-tracked, and each conversation resumes where it
          left off.
        </p>
        <Button className="mt-6 rounded-full h-10 px-5" onClick={create}>
          <Sparkles className="size-4" /> Start a new thread
        </Button>
        <div className="mt-6 text-[11px] text-muted-foreground font-mono">
          ws: {socket.wsStatus}
        </div>
      </div>
    </div>
  );
}
