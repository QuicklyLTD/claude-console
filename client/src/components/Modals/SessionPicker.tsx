import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { compareSessions, formatRelative } from "@/lib/utils";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { api } from "@/lib/api";
import { Search } from "lucide-react";

export function SessionPicker() {
  const show = useUiStore((s) => s.showSessionPicker);
  const setShow = useUiStore((s) => s.setShowSessionPicker);
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActive = useSessionStore((s) => s.setActiveSession);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (show) {
      api.listSessions().then((r) => setSessions(r.sessions)).catch(() => void 0);
      setQ("");
    }
  }, [show, setSessions]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = needle
      ? sessions.filter((s) => s.title.toLowerCase().includes(needle))
      : sessions;
    return [...arr].sort(compareSessions).slice(0, 40);
  }, [sessions, q]);

  function pick(id: string) {
    setActive(id);
    setShow(false);
  }

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="max-w-xl p-0 overflow-hidden" hideClose>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" /> Jump to session
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search and switch to any past conversation.
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" />
        </div>
        <ScrollArea className="max-h-[60vh]">
          <ul className="p-2 space-y-0.5">
            {list.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No match.</li>}
            {list.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-accent/80 transition flex items-center gap-3"
                  onClick={() => pick(s.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{s.title}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {s.workingDir ?? "(no cwd)"} · {formatRelative(s.updatedAt)}
                    </div>
                  </div>
                  {s.totalTurns > 0 && <Badge variant="outline">{s.totalTurns}</Badge>}
                  {s.totalCostUsd > 0 && <Badge variant="primary">${s.totalCostUsd.toFixed(2)}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
