import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUiStore } from "@/store/ui";
import { useSessionStore } from "@/store/session";

/**
 * Surfaces file-history-snapshot events from the current SDK transcript.
 * For v0, it simply points the user to the SDK's own `file-history/` store.
 * The full diff/revert flow can be layered on later by wiring
 * sdkMessages → file snapshot events.
 */
export function FileHistoryPanel() {
  const show = useUiStore((s) => s.showFileHistory);
  const setShow = useUiStore((s) => s.setShowFileHistory);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>File history</DialogTitle>
          <DialogDescription>
            Snapshots the Claude Agent SDK captured before mutating files in this session.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {!active ? (
            <div className="text-sm text-muted-foreground p-4">No active session.</div>
          ) : (
            <div className="p-2 space-y-2 text-sm">
              <div className="text-muted-foreground">
                Snapshots for the currently attached SDK session live on disk under:
              </div>
              <pre className="rounded-md bg-muted/40 p-2 text-[11px] font-mono whitespace-pre-wrap">
                ~/.claude/file-history/{active.sdkSessionId ?? "<sdk-session-id>"}/
              </pre>
              <div className="text-muted-foreground">
                Each file mutation writes a new blob keyed by content hash with an <code>@v2</code>/<code>@v3</code> suffix.
                To revert a file, stop the agent, copy the snapshot over the live file and attach again.
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
