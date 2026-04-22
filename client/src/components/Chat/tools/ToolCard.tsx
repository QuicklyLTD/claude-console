import { type ReactNode, useState } from "react";
import { ChevronRight, Check, X, Loader2, Copy } from "lucide-react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import { cn } from "@/lib/utils";

export type ToolState = "pending" | "done" | "error";

/** Accept any status object shape (MessagePartStatus | ToolCallMessagePartStatus). */
export function deriveToolState(status: { type: string }, isError?: boolean): ToolState {
  if (isError) return "error";
  if (status.type === "running" || status.type === "requires-action") return "pending";
  if (status.type === "incomplete") return "error";
  return "done";
}

interface ToolCardProps {
  icon: ReactNode;
  name: string;
  /** Short inline summary shown next to the name (e.g. first arg, file path). */
  summary?: ReactNode;
  /** Right-side info before the status chip (e.g. duration, match count). */
  meta?: ReactNode;
  state: ToolState;
  children?: ReactNode;
  /** When true, card is expanded by default. Errors are always expanded. */
  defaultOpen?: boolean;
}

/**
 * Shared shell for all tool renderers. Collapsible card with a consistent
 * header (icon + name + summary + status chip) and a body slot filled by
 * per-tool components.
 */
export function ToolCard({ icon, name, summary, meta, state, children, defaultOpen }: ToolCardProps) {
  const [open, setOpen] = useState(defaultOpen ?? state !== "done");

  return (
    <div
      className={cn(
        "my-2 rounded-lg border bg-muted/30 overflow-hidden relative",
        state === "error" && "border-destructive/40",
        state === "pending" && "border-primary/40 tool-card-pending",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition"
      >
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="shrink-0 text-primary">{icon}</span>
        <span className="font-mono font-medium shrink-0">{name}</span>
        {summary != null && (
          <span className="text-muted-foreground truncate font-mono min-w-0">{summary}</span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {meta != null && <span className="text-[11px] text-muted-foreground">{meta}</span>}
          <StatusChip state={state} />
        </div>
      </button>
      {open && children != null && (
        <div className="border-t bg-background/60">{children}</div>
      )}
    </div>
  );
}

function StatusChip({ state }: { state: ToolState }) {
  if (state === "pending") return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Loader2 className="size-3 animate-spin" /> running
    </span>
  );
  if (state === "error") return (
    <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
      <X className="size-3" /> error
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-success">
      <Check className="size-3" /> done
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
      {children}
    </div>
  );
}

/** Monospace preformatted block with safe overflow / line-wrap. */
export function Code({ children, className, maxH = 360 }: { children: ReactNode; className?: string; maxH?: number }) {
  return (
    <pre
      className={cn(
        "mx-3 my-2 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] font-mono leading-snug whitespace-pre-wrap",
        className,
      )}
      style={{ maxHeight: maxH }}
    >
      {children}
    </pre>
  );
}

/**
 * Monospace block with left-gutter line numbers and Prism syntax highlighting.
 * `language` is inferred from file extension by callers; unknown → plain text.
 */
export function NumberedCode({
  text,
  startLine = 1,
  maxH = 480,
  language,
  className,
}: {
  text: string;
  startLine?: number;
  maxH?: number;
  language?: string;
  className?: string;
}) {
  if (!text) return null;
  const lang = (language && SUPPORTED_LANGS.has(language) ? language : "text") as Language;
  return (
    <div
      className={cn("mx-3 my-2 overflow-auto rounded-md bg-muted/60 text-[11px] font-mono", className)}
      style={{ maxHeight: maxH }}
    >
      <Highlight code={text} language={lang} theme={themes.vsDark}>
        {({ tokens, getLineProps, getTokenProps }) => {
          const lastLine = startLine + tokens.length - 1;
          const pad = String(lastLine).length;
          return (
            <pre className="leading-snug m-0" style={{ background: "transparent" }}>
              {tokens.map((line, i) => {
                const { key: _lineKey, ...lineProps } = getLineProps({ line });
                void _lineKey;
                return (
                  <div key={i} {...lineProps} className="flex">
                    <span className="shrink-0 select-none pl-2 pr-3 text-right text-muted-foreground/60 border-r border-border/40 tabular-nums">
                      {String(startLine + i).padStart(pad, " ")}
                    </span>
                    <span className="pl-2 pr-2 whitespace-pre-wrap break-words flex-1 min-w-0">
                      {line.map((token, ti) => {
                        const { key: _tk, ...tp } = getTokenProps({ token });
                        void _tk;
                        return <span key={ti} {...tp} />;
                      })}
                    </span>
                  </div>
                );
              })}
            </pre>
          );
        }}
      </Highlight>
    </div>
  );
}

/**
 * Syntax-highlighted block without line numbers. Used for Write/Edit content
 * snippets where line numbers don't align with real file line numbers.
 */
export function HighlightedCode({
  text,
  language,
  maxH = 440,
  tone,
}: {
  text: string;
  language?: string;
  maxH?: number;
  tone?: "added" | "plain";
}) {
  if (!text) return null;
  const lang = (language && SUPPORTED_LANGS.has(language) ? language : "text") as Language;
  return (
    <div
      className={cn(
        "mx-3 my-2 overflow-auto rounded-md",
        tone === "added" ? "border-l-2 border-success bg-success/5" : "bg-muted/60",
      )}
      style={{ maxHeight: maxH }}
    >
      <Highlight code={text} language={lang} theme={themes.vsDark}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="p-2 text-[11px] font-mono leading-snug m-0" style={{ background: "transparent" }}>
            {tokens.map((line, i) => {
              const { key: _lineKey, ...lineProps } = getLineProps({ line });
              void _lineKey;
              return (
                <div key={i} {...lineProps} className="whitespace-pre-wrap break-words">
                  {line.map((token, ti) => {
                    const { key: _tk, ...tp } = getTokenProps({ token });
                    void _tk;
                    return <span key={ti} {...tp} />;
                  })}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

/** Prism language ids we actually ship with prism-react-renderer's default refractor. */
const SUPPORTED_LANGS = new Set<string>([
  "markup", "html", "xml", "svg",
  "css", "scss", "sass",
  "js", "jsx", "javascript", "ts", "tsx", "typescript",
  "json", "yaml", "toml",
  "python", "ruby", "go", "rust", "java", "c", "cpp", "csharp",
  "bash", "shell", "sh",
  "sql", "graphql", "markdown", "md",
  "diff", "text",
]);

/**
 * Infer a Prism language id from a file path's extension.
 * Returns "text" for unknown extensions.
 */
export function languageFromPath(path: string): string {
  const ext = path.split("/").pop()?.split(".").pop()?.toLowerCase();
  if (!ext) return "text";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx",
    js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
    json: "json", jsonc: "json",
    py: "python", rb: "ruby", go: "go", rs: "rust",
    java: "java", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
    cs: "csharp",
    html: "markup", htm: "markup", xml: "markup", svg: "markup",
    css: "css", scss: "scss", sass: "sass",
    yml: "yaml", yaml: "yaml", toml: "toml",
    sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql",
    md: "markdown", markdown: "markdown",
  };
  return map[ext] ?? "text";
}

/** Copy-to-clipboard button — shows check for 1.5s after click. */
export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value) return;
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      // Permission errors (e.g. document not focused) fall through silently —
      // the user retries once focus returns. Log at debug only.
      (err: unknown) => { if (typeof console !== "undefined") console.debug("copy failed", err); },
    );
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={!value}
      aria-label={label ?? "Copy"}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
        "text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-30",
        className,
      )}
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      {label && <span>{copied ? "copied" : label}</span>}
    </button>
  );
}

/** Header row inside a tool card: label on left, action buttons on right. */
export function ActionRow({ label, children }: { label?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}
