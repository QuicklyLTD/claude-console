import React, { useEffect, useMemo, useState } from "react";
import { MessageSquare, Plus, Pin, PinOff, Trash2, Search } from "lucide-react";
import type { UISessionRow } from "@shared/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, compareSessions, formatRelative } from "@/lib/utils";
import { api } from "@/lib/api";
import { useSessionStore } from "@/store/session";

/* ---------- date grouping ------------------------------------------------ */

type Bucket = "today" | "yesterday" | "week" | "older";
const BUCKET_LABEL: Record<Bucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 days",
  older: "Older",
};

function bucketOf(ts: number): Bucket {
  const now = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = day(now);
  const yesterday = today - 86_400_000;
  const weekStart = today - 6 * 86_400_000;
  if (ts >= today) return "today";
  if (ts >= yesterday) return "yesterday";
  if (ts >= weekStart) return "week";
  return "older";
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActiveSession);
  const setSessions = useSessionStore((s) => s.setSessions);
  const upsert = useSessionStore((s) => s.upsertSession);
  const remove = useSessionStore((s) => s.removeSession);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<UISessionRow | null>(null);

  useEffect(() => {
    api.listSessions().then((r) => setSessions(r.sessions)).catch(() => void 0);
  }, [setSessions]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)))
      : sessions;
    const sorted = [...list].sort(compareSessions);

    const order: Bucket[] = ["today", "yesterday", "week", "older"];
    const buckets = new Map<Bucket, UISessionRow[]>();
    for (const b of order) buckets.set(b, []);
    const pinned: UISessionRow[] = [];
    for (const s of sorted) {
      if (s.pinned) { pinned.push(s); continue; }
      buckets.get(bucketOf(s.updatedAt))!.push(s);
    }
    return { pinned, buckets, order };
  }, [sessions, query]);

  async function createNew() {
    const { session } = await api.createSession({});
    upsert(session);
    setActive(session.id);
  }

  async function togglePin(s: UISessionRow) {
    const { session } = await api.patchSession(s.id, { pinned: !s.pinned });
    upsert(session);
  }

  function requestDelete(s: UISessionRow) {
    setPendingDelete(s);
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await api.deleteSession(id);
    remove(id);
  }

  const total = sessions.length;
  const hasResults = grouped.pinned.length > 0 || grouped.order.some((b) => grouped.buckets.get(b)!.length > 0);

  return (
    <aside className="w-64 shrink-0 border-r bg-muted/30 flex flex-col">
      <div className="px-3 py-3">
        <Button className="w-full justify-between" onClick={createNew}>
          <span className="inline-flex items-center gap-2">
            <Plus className="size-4" /> New Thread
          </span>
          <span className="text-[10px] font-mono opacity-70">⌘N</span>
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads"
            className="pl-8 h-8 text-xs bg-background"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-2">
        {!hasResults ? (
          <div className="px-3 py-10 text-center text-xs text-muted-foreground">
            {query ? "No match." : "No threads yet."}
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            {grouped.pinned.length > 0 && (
              <Group label="Pinned">
                {grouped.pinned.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    active={s.id === activeId}
                    onActivate={() => setActive(s.id)}
                    onTogglePin={() => togglePin(s)}
                    onDelete={() => requestDelete(s)}
                  />
                ))}
              </Group>
            )}
            {grouped.order.map((b) => {
              const items = grouped.buckets.get(b)!;
              if (items.length === 0) return null;
              return (
                <Group key={b} label={BUCKET_LABEL[b]}>
                  {items.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      active={s.id === activeId}
                      onActivate={() => setActive(s.id)}
                      onTogglePin={() => togglePin(s)}
                      onDelete={() => requestDelete(s)}
                    />
                  ))}
                </Group>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="px-3 py-2.5 border-t text-[11px] text-muted-foreground flex items-center justify-between">
        <span className="font-mono">{total} thread{total !== 1 ? "s" : ""}</span>
        <span className="font-mono opacity-70">⌘K search</span>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete "${pendingDelete?.title ?? ""}"?`}
        description="The session transcript and its SDK-side JSONL will be removed. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </aside>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 pb-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function SessionItem({
  session,
  active,
  onActivate,
  onTogglePin,
  onDelete,
}: {
  session: UISessionRow;
  active: boolean;
  onActivate: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  function onRowKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  }
  return (
    <li
      className={cn(
        "group relative flex items-center rounded-md transition",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onActivate}
        onKeyDown={onRowKeyDown}
        aria-pressed={active}
        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 cursor-pointer"
      >
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm">{session.title}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {formatRelative(session.updatedAt)}
            {session.totalTurns > 0 ? ` · ${session.totalTurns} turns` : ""}
          </div>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition flex items-center gap-0.5 pr-1">
        <button
          type="button"
          onClick={onTogglePin}
          className="p-1 rounded hover:bg-background text-muted-foreground"
          aria-label={session.pinned ? "Unpin session" : "Pin session"}
        >
          {session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
          aria-label="Delete session"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
