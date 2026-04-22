import { useState, type PropsWithChildren, Children } from "react";
import { ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolGroupProps {
  startIndex: number;
  endIndex: number;
}

/**
 * Collapsible grouping for consecutive tool calls. Auto-collapses when the
 * group has ≥3 tools so Claude's long tool chains don't overwhelm the view.
 *
 * Single tool calls bypass the wrapper entirely.
 */
export function ToolGroup({ startIndex, endIndex, children }: PropsWithChildren<ToolGroupProps>) {
  const count = endIndex - startIndex + 1;
  const items = Children.toArray(children);
  const [open, setOpen] = useState(count < 3);

  if (count < 2) return <>{children}</>;

  return (
    <div className="my-2 rounded-lg border border-dashed bg-muted/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/40 transition"
      >
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Layers className="size-3.5 shrink-0 text-primary" />
        <span className="font-medium">{count} tool calls</span>
        <span className="text-muted-foreground">· {open ? "collapse" : "expand"}</span>
      </button>
      {open && <div className="border-t px-1 py-1 space-y-0">{items}</div>}
    </div>
  );
}
