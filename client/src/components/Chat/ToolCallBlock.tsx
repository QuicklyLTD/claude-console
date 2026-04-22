import { useState } from "react";
import { ChevronRight, Check, X, Loader2, Terminal, FileText, FilePenLine, Search, Globe, Folder, Wrench } from "lucide-react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { cn, safeStringify, truncate } from "@/lib/utils";

function iconFor(name: string) {
  const n = name.toLowerCase();
  if (n === "bash") return Terminal;
  if (n === "read" || n === "notebookread") return FileText;
  if (n === "edit" || n === "write" || n === "notebookedit") return FilePenLine;
  if (n === "grep" || n === "toolsearch") return Search;
  if (n === "glob" || n === "ls") return Folder;
  if (n === "webfetch" || n === "websearch") return Globe;
  return Wrench;
}

/**
 * Native tool-call renderer. Registered via `MessagePrimitive.Content`
 * `components.tools.Fallback` (see Chat.tsx), so assistant-ui feeds us
 * `ToolCallMessagePartProps` directly.
 *
 * `status.type === "running"` ⇢ pending; `isError` ⇢ error; otherwise done.
 */
export function ToolCallBlock(props: ToolCallMessagePartProps) {
  const { toolName, args, result, isError, status } = props;
  const state: "pending" | "done" | "error" =
    isError ? "error" : status.type === "running" ? "pending" : "done";

  const [openIn, setOpenIn] = useState(false);
  const [openOut, setOpenOut] = useState(state !== "done");
  const Icon = iconFor(toolName);

  const statusChip =
    state === "pending" ? (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> running
      </span>
    ) : state === "error" ? (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <X className="h-3 w-3" /> error
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check className="h-3 w-3" /> done
      </span>
    );

  const inputText = safeStringify(args, { indent: 2 });
  const outputText = formatResult(result);
  const inputPreview = truncate(inputText.replace(/\s+/g, " "), 120);
  const outputPreview = truncate(outputText, 240);

  return (
    <div
      className={cn(
        "my-2 rounded-lg border bg-muted/30",
        state === "error" && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-mono font-medium">{toolName}</span>
        <span className="text-muted-foreground truncate font-mono">
          {inputPreview.text}{inputPreview.truncated ? "…" : ""}
        </span>
        <div className="ml-auto">{statusChip}</div>
      </div>

      <button
        type="button"
        onClick={() => setOpenIn((v) => !v)}
        aria-expanded={openIn}
        aria-label={`${toolName} input (${openIn ? "collapse" : "expand"})`}
        className="flex w-full items-center gap-1 border-t px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted/50"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", openIn && "rotate-90")} />
        input
      </button>
      {openIn && (
        <pre className="mx-3 mb-2 max-h-[280px] overflow-auto rounded-md bg-background p-2 text-[11px] font-mono leading-snug">
          {inputText}
        </pre>
      )}

      {(outputText || state !== "pending") && (
        <>
          <button
            type="button"
            onClick={() => setOpenOut((v) => !v)}
            aria-expanded={openOut}
            aria-label={`${toolName} output (${openOut ? "collapse" : "expand"})`}
            className={cn(
              "flex w-full items-center gap-1 border-t px-3 py-1 text-[11px] hover:bg-muted/50",
              state === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", openOut && "rotate-90")} />
            {state === "pending" ? "output (streaming)" : "output"}
            {outputText.length > 240 && !openOut && (
              <span className="ml-1 font-mono opacity-70">· preview: {outputPreview.text.slice(0, 64)}…</span>
            )}
          </button>
          {openOut && (
            <pre className="mx-3 mb-3 max-h-[440px] overflow-auto rounded-md bg-background p-2 text-[11px] font-mono leading-snug whitespace-pre-wrap">
              {outputText || (state === "pending" ? "(no output yet)" : "")}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function formatResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  return safeStringify(result, { indent: 2 });
}
