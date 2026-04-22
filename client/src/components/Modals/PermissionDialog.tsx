import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield } from "lucide-react";
import { usePermissionStore, type PendingPermission } from "@/store/permission";
import type { AgentSocketApi } from "@/hooks/useAgentSocket";
import { safeStringify } from "@/lib/utils";

type Scope = "once" | "session" | "project" | "user";

export function PermissionDialog({ socket }: { socket: AgentSocketApi }) {
  const pending = usePermissionStore((s) => s.permissionQueue[0]);
  if (!pending) return null;
  // Key by requestId so state (scope) is fully reset when a new request arrives.
  return <PermissionDialogInner key={pending.requestId} pending={pending} socket={socket} />;
}

function PermissionDialogInner({
  pending,
  socket,
}: {
  pending: PendingPermission;
  socket: AgentSocketApi;
}) {
  const pop = usePermissionStore((s) => s.popPermission);
  const [scope, setScope] = useState<Scope>("once");

  function send(allow: boolean, message?: string) {
    socket.decidePermission({
      kind: "permission_decision",
      requestId: pending.requestId,
      decision: {
        behavior: allow ? "allow" : "deny",
        scope,
        message,
        updatedPermissions:
          allow && (scope === "project" || scope === "user") ? pending.suggestions : undefined,
      },
    });
    pop(pending.requestId);
  }

  const canPersist = pending.suggestions && pending.suggestions.length > 0;

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) send(false, "Canceled"); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="size-4 text-primary" />
            <Badge variant="primary" className="font-mono">{pending.toolName}</Badge>
          </div>
          <DialogTitle>{pending.title ?? `Claude wants to run ${pending.displayName ?? pending.toolName}`}</DialogTitle>
          <DialogDescription>
            {pending.description ?? `Tool call awaiting your approval. Choose a scope below.`}
          </DialogDescription>
        </DialogHeader>

        {pending.decisionReason && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 text-warning-foreground p-2 text-xs">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-warning" />
            <div className="text-warning">{pending.decisionReason}</div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">input</div>
          <pre className="max-h-[260px] overflow-auto rounded-md bg-muted/40 p-2 text-[11px] font-mono whitespace-pre-wrap">
            {safeStringify(pending.input, { indent: 2 })}
          </pre>
        </div>

        {pending.blockedPath && (
          <div className="text-[11px] text-muted-foreground font-mono">
            blocked path: {pending.blockedPath}
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">scope</div>
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="grid gap-1.5">
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="once" /> Just this once
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="session" /> Always allow for this session
            </label>
            {canPersist && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="project" /> Allow permanently (project)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="user" /> Allow permanently (user)
                </label>
              </>
            )}
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => send(false, "Denied by user")}>Deny</Button>
          <Button onClick={() => send(true)}>Allow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

