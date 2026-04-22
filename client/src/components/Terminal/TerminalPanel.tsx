import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare, X, RotateCcw, Plus, Trash2 } from "lucide-react";
import type { AgentSocketApi } from "@/hooks/useAgentSocket";
import { useUiStore } from "@/store/ui";
import { cn } from "@/lib/utils";

interface Props {
  socket: AgentSocketApi;
  /** Tied to the active session — re-mount on switch so the pty rebinds to the new cwd. */
  sessionId: string;
  /** Visible cwd (informational header). */
  cwd: string | null;
}

const QUICK_COMMANDS_KEY = "claude-console:quick-cmds";
const DEFAULT_QUICK_CMDS = [
  "git status",
  "ls -la",
  "pwd",
  "clear",
];

function loadQuickCmds(): string[] {
  try {
    const raw = localStorage.getItem(QUICK_COMMANDS_KEY);
    if (!raw) return DEFAULT_QUICK_CMDS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
  } catch { /* ignore */ }
  return DEFAULT_QUICK_CMDS;
}
function saveQuickCmds(cmds: string[]) {
  try { localStorage.setItem(QUICK_COMMANDS_KEY, JSON.stringify(cmds)); } catch { /* ignore */ }
}

/**
 * Persistent xterm.js panel sitting under the chat. Each TerminalPanel mount
 * opens a fresh server-side pty in the active session's working directory.
 * Output streams in via WS frames; user keystrokes are forwarded to the pty.
 *
 * Lifecycle: open on mount → resize on container resize → close on unmount.
 */
export function TerminalPanel({ socket, sessionId, cwd }: Props) {
  const setOpen = useUiStore((s) => s.setTerminalOpen);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"opening" | "ready" | "exited" | "error">("opening");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [quickCmds, setQuickCmds] = useState<string[]>(() => loadQuickCmds());
  const [editingCmds, setEditingCmds] = useState(false);
  const [draftCmd, setDraftCmd] = useState("");

  function runQuickCmd(cmd: string) {
    const term = xtermRef.current;
    if (!term) return;
    // Forward as raw input (newline submits). Special-case "clear" → use xterm's reset
    // so the output buffer also clears, not just terminal screen.
    if (cmd.trim() === "clear") {
      term.clear();
      socket.termInput("\n"); // refresh prompt
      return;
    }
    socket.termInput(cmd + "\n");
    term.focus();
  }
  function addCmd() {
    const c = draftCmd.trim();
    if (!c) return;
    if (quickCmds.includes(c)) { setDraftCmd(""); return; }
    const next = [...quickCmds, c].slice(0, 20);
    setQuickCmds(next);
    saveQuickCmds(next);
    setDraftCmd("");
  }
  function removeCmd(c: string) {
    const next = quickCmds.filter((x) => x !== c);
    setQuickCmds(next);
    saveQuickCmds(next);
  }
  // Memo per identity so we re-render the chip row predictably.
  const chipRow = useMemo(() => quickCmds, [quickCmds]);

  // Mount xterm + open server pty.
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    xtermRef.current = term;
    fitRef.current = fit;

    // Initial fit then open pty with computed dims.
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* container may be 0 */ }
      const cols = term.cols || 80;
      const rows = term.rows || 24;
      socket.termOpen(cols, rows);
    });

    // Forward keystrokes.
    const dataDisposable = term.onData((data) => socket.termInput(data));

    // Server → terminal.
    const offTerm = socket.onTerm((f) => {
      if (f.kind === "output") term.write(f.data);
      else if (f.kind === "event") {
        if (f.event === "opened") setStatus("ready");
        if (f.event === "exited") {
          setStatus("exited");
          term.write(`\r\n\x1b[2m[process exited${f.exitCode != null ? ` (${f.exitCode})` : ""}]\x1b[0m\r\n`);
        }
        if (f.event === "error") {
          setStatus("error");
          setErrMsg(f.message ?? "terminal error");
        }
      }
    });

    // Auto-fit on resize.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        socket.termResize(term.cols, term.rows);
      } catch { /* noop */ }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      offTerm();
      dataDisposable.dispose();
      socket.termClose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
    // sessionId change ⇒ remount via parent's `key` prop, no need to re-run on socket changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function restart() {
    setStatus("opening");
    setErrMsg(null);
    socket.termClose();
    const t = xtermRef.current;
    if (t) {
      t.clear();
      socket.termOpen(t.cols || 80, t.rows || 24);
    }
  }

  return (
    <div className="flex flex-col bg-[#0c0c0e] text-[13px]" style={{ height: "40%", minHeight: 180 }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-y bg-muted/40 text-[11px]">
        <TerminalSquare className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-muted-foreground truncate">
          {cwd ?? "~"}
        </span>
        <span className={cn("ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium",
          status === "ready" ? "text-success" : status === "error" ? "text-destructive" : "text-muted-foreground",
        )}>
          <span className={cn("size-1.5 rounded-full",
            status === "ready" ? "bg-success" : status === "error" ? "bg-destructive" : status === "exited" ? "bg-warning" : "bg-muted-foreground/60 animate-pulse",
          )} />
          {status}
        </span>
        <button
          type="button"
          onClick={restart}
          className="inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition"
          aria-label="Restart shell"
          title="Restart"
        >
          <RotateCcw className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition"
          aria-label="Close terminal"
          title="Close (Cmd+J)"
        >
          <X className="size-3" />
        </button>
      </div>
      {errMsg && (
        <div className="px-3 py-1.5 text-[11px] text-destructive bg-destructive/10 border-b border-destructive/30">
          {errMsg}
        </div>
      )}

      <div className="flex items-center gap-1 px-2 py-1 overflow-x-auto bg-muted/20 border-b">
        {chipRow.map((c) => (
          <div key={c} className="group relative shrink-0">
            <button
              type="button"
              onClick={() => runQuickCmd(c)}
              className="inline-flex items-center h-6 px-2 rounded-md border bg-background/60 hover:bg-background text-[11px] font-mono text-muted-foreground hover:text-foreground transition"
              title={`Run: ${c}`}
              disabled={status !== "ready"}
            >
              {c}
            </button>
            {editingCmds && (
              <button
                type="button"
                onClick={() => removeCmd(c)}
                className="absolute -top-1 -right-1 size-3.5 rounded-full bg-destructive text-destructive-foreground grid place-items-center"
                aria-label={`Remove ${c}`}
                title="Remove"
              >
                <X className="size-2.5" strokeWidth={3} />
              </button>
            )}
          </div>
        ))}

        {editingCmds ? (
          <div className="inline-flex items-center gap-1 ml-1">
            <input
              autoFocus
              value={draftCmd}
              onChange={(e) => setDraftCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addCmd(); }
                if (e.key === "Escape") { setDraftCmd(""); setEditingCmds(false); }
              }}
              placeholder="new command…"
              className="h-6 w-44 px-2 rounded-md border bg-background text-[11px] font-mono outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={addCmd}
              disabled={!draftCmd.trim()}
              className="inline-flex items-center justify-center size-6 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
              aria-label="Add command"
              title="Add"
            >
              <Plus className="size-3" strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => { setEditingCmds(false); setDraftCmd(""); }}
              className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Done"
              title="Done"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingCmds(true)}
            className="inline-flex items-center justify-center size-6 ml-1 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
            aria-label="Manage quick commands"
            title="Manage quick commands"
          >
            <Plus className="size-3" />
          </button>
        )}

        {editingCmds && quickCmds.length > 0 && (
          <button
            type="button"
            onClick={() => { setQuickCmds(DEFAULT_QUICK_CMDS); saveQuickCmds(DEFAULT_QUICK_CMDS); }}
            className="inline-flex items-center gap-1 h-6 px-2 ml-auto shrink-0 rounded-md text-[10px] text-muted-foreground hover:text-destructive transition"
            title="Reset to defaults"
          >
            <Trash2 className="size-3" /> reset
          </button>
        )}
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden p-2" />
    </div>
  );
}

/** Read CSS vars to make the terminal blend with the app theme. */
function themeFromCss() {
  if (typeof window === "undefined") return undefined;
  const style = getComputedStyle(document.documentElement);
  const fg = `hsl(${style.getPropertyValue("--foreground").trim()})`;
  const bg = `hsl(${style.getPropertyValue("--background").trim()})`;
  const muted = `hsl(${style.getPropertyValue("--muted-foreground").trim()})`;
  return {
    background: bg.includes("3.9") ? "#0c0c0e" : "#fafafa",
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: muted + "55",
    black: "#000000",
    red: "#ef4444",
    green: "#22c55e",
    yellow: "#eab308",
    blue: "#3b82f6",
    magenta: "#a855f7",
    cyan: "#06b6d4",
    white: "#e5e5e5",
    brightBlack: "#525252",
    brightRed: "#f87171",
    brightGreen: "#4ade80",
    brightYellow: "#facc15",
    brightBlue: "#60a5fa",
    brightMagenta: "#c084fc",
    brightCyan: "#22d3ee",
    brightWhite: "#ffffff",
  };
}
