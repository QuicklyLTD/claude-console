import { useState } from "react";
import { Check, Pencil, X, MoreHorizontal, Settings2, History, StopCircle, PanelLeft, Shield, Cpu, TerminalSquare } from "lucide-react";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { UISessionRow } from "@shared/protocol";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session";
import type { AgentSocketApi } from "@/hooks/useAgentSocket";
import { useUiStore } from "@/store/ui";

interface Props {
  session: UISessionRow;
  socket: AgentSocketApi;
}

export function TopBar({ session, socket }: Props) {
  const status = useSessionStore((s) => s.status);
  const upsert = useSessionStore((s) => s.upsertSession);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const setShowSettings = useUiStore((s) => s.setShowSettings);
  const setShowFileHistory = useUiStore((s) => s.setShowFileHistory);
  const terminalOpen = useUiStore((s) => s.terminalOpen);
  const setTerminalOpen = useUiStore((s) => s.setTerminalOpen);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  async function saveTitle() {
    const title = draft.trim();
    if (!title || title === session.title) {
      setEditing(false);
      setDraft(session.title);
      return;
    }
    const { session: updated } = await api.patchSession(session.id, { title });
    upsert(updated);
    setEditing(false);
  }

  async function patchMode(mode: PermissionMode) {
    socket.setPermissionMode({ kind: "set_permission_mode", mode });
    const { session: updated } = await api.patchSession(session.id, { permissionMode: mode });
    upsert(updated);
  }

  async function patchModel(model: string) {
    const next = model === "__default__" ? null : model;
    socket.setModel(next);
    const { session: updated } = await api.patchSession(session.id, { model: next });
    upsert(updated);
  }

  const running = status === "running";

  return (
    <header className="h-12 shrink-0 border-b bg-background flex items-center gap-2 px-3">
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="size-4" />
      </Button>

      <div className="flex items-center gap-1 min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-1 min-w-0 flex-1 max-w-md">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveTitle();
                if (e.key === "Escape") { setEditing(false); setDraft(session.title); }
              }}
              className="h-7 text-sm"
            />
            <Button size="icon-sm" variant="ghost" onClick={saveTitle}><Check className="size-3.5" /></Button>
            <Button size="icon-sm" variant="ghost" onClick={() => { setEditing(false); setDraft(session.title); }}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group inline-flex items-center gap-1.5 max-w-full py-1 px-1.5 -mx-1.5 rounded-md hover:bg-accent transition"
            aria-label="Rename session"
          >
            <span className="truncate text-sm font-medium">{session.title}</span>
            <Pencil className="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition" />
          </button>
        )}
      </div>

      {/* Model */}
      <Select value={session.model ?? "__default__"} onValueChange={patchModel}>
        <SelectTrigger className="h-8 w-[140px] gap-1.5">
          <Cpu className="size-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">default</SelectItem>
          <SelectItem value="sonnet">sonnet</SelectItem>
          <SelectItem value="opus">opus</SelectItem>
          <SelectItem value="haiku">haiku</SelectItem>
        </SelectContent>
      </Select>

      {/* Permission mode */}
      <Select value={session.permissionMode} onValueChange={(v) => patchMode(v as PermissionMode)}>
        <SelectTrigger className="h-8 w-[140px] gap-1.5">
          <Shield className="size-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">default</SelectItem>
          <SelectItem value="acceptEdits">acceptEdits</SelectItem>
          <SelectItem value="plan">plan</SelectItem>
          <SelectItem value="bypassPermissions">bypass</SelectItem>
        </SelectContent>
      </Select>

      {/* Terminal toggle */}
      <Button
        size="icon-sm"
        variant={terminalOpen ? "secondary" : "ghost"}
        onClick={() => setTerminalOpen(!terminalOpen)}
        aria-label={terminalOpen ? "Hide terminal" : "Show terminal"}
        title="Terminal (⌘J)"
      >
        <TerminalSquare className="size-4" />
      </Button>

      {/* Interrupt when running */}
      {running && (
        <Button size="icon-sm" variant="warning" onClick={() => socket.interrupt()} aria-label="Interrupt">
          <StopCircle className="size-4" />
        </Button>
      )}

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Session</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setShowSettings(true)}>
            <Settings2 className="size-3.5" /> Settings
            <span className="ml-auto text-[10px] font-mono opacity-60">⌘,</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShowFileHistory(true)}>
            <History className="size-3.5" /> File history
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {session.workingDir && (
            <>
              <DropdownMenuLabel>Working directory</DropdownMenuLabel>
              <div className="px-2 py-1 text-[11px] font-mono text-muted-foreground break-all">
                {session.workingDir}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <StatusDot status={status} />
    </header>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-primary animate-pulse"
      : status === "error"
      ? "bg-destructive"
      : status === "attached"
      ? "bg-success"
      : status === "interrupted"
      ? "bg-warning"
      : "bg-muted-foreground/40";
  return <span className={cn("w-2 h-2 rounded-full shrink-0", cls)} aria-hidden />;
}
