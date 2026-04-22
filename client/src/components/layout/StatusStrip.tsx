import { Badge } from "@/components/ui/badge";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { formatCost, formatTokens } from "@/lib/utils";

/**
 * Thin strip shown under the TopBar. Displays "quiet" stream events as
 * small non-intrusive badges (rate limit, last usage, cache read).
 */
export function StatusStrip() {
  const lastTurn = useSessionStore((s) => s.lastTurn);
  const rateLimit = useSessionStore((s) => s.rateLimit);
  const quiet = useUiStore((s) => s.quietMode);

  if (quiet && !lastTurn && !rateLimit) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-1 text-[11px] text-muted-foreground border-b bg-background/60 flex-wrap">
      {lastTurn && (
        <span>
          last · {formatCost(lastTurn.turnCostUsd)} · {lastTurn.durationMs}ms · out {formatTokens(lastTurn.output)}
          {lastTurn.cacheRead ? ` · cache ${formatTokens(lastTurn.cacheRead)}` : ""}
        </span>
      )}
      {lastTurn && rateLimit && <span className="opacity-40">·</span>}
      {rateLimit && (
        <Badge variant={rateLimit.status === "allowed" ? "outline" : "warning"} className="h-5 text-[10px]">
          {rateLimit.status}
          {rateLimit.resetsAt ? ` · ${relMin(rateLimit.resetsAt)}` : ""}
        </Badge>
      )}
    </div>
  );
}

function relMin(resetsAtSec: number): string {
  const min = Math.max(0, Math.round((resetsAtSec * 1000 - Date.now()) / 60000));
  return `${min}m`;
}
