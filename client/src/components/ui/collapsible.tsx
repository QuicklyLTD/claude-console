import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleProps {
  title: React.ReactNode;
  /** Plain-string label used for the aria-label of the trigger. */
  ariaLabel?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Collapsible({ title, ariaLabel, defaultOpen = false, className, children }: CollapsibleProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const regionId = React.useId();
  return (
    <div className={cn("rounded-md border border-border overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={ariaLabel}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        <span className="truncate">{title}</span>
      </button>
      {open ? (
        <div id={regionId} role="region" className="p-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
