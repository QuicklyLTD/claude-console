import { Terminal, FileText, FilePenLine, Search, Folder, Globe, CheckSquare, Square, ArrowRight, Plus, Minus, ExternalLink, Bot, Wand2 } from "lucide-react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { useThreadRuntime } from "@assistant-ui/react";
import { cn, safeStringify, truncate } from "@/lib/utils";
import { ToolCard, SectionLabel, Code, NumberedCode, HighlightedCode, CopyButton, ActionRow, deriveToolState, languageFromPath } from "./ToolCard";

/* ---------- type helpers -------------------------------------------------- */

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : safeStringify(v, { indent: 0 });
}

function resultString(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  return safeStringify(result, { indent: 2 });
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : p;
}

/** Open a local absolute path in VSCode via its URL scheme. */
function vscodeUrl(path: string, line?: number): string | null {
  if (!path || !path.startsWith("/")) return null;
  return `vscode://file${path}${line ? `:${line}` : ""}`;
}

function OpenInEditor({ path, line }: { path: string; line?: number }) {
  const url = vscodeUrl(path, line);
  if (!url) return null;
  return (
    <a
      href={url}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition"
      title={`Open ${path} in editor`}
    >
      <ExternalLink className="size-3" /> open
    </a>
  );
}

/**
 * Ask Claude to diagnose a tool failure. Appends a fresh user turn with the
 * failing tool context so the assistant can propose a fix or retry with
 * adjusted args.
 */
function FixErrorButton({ toolName, args, output }: { toolName: string; args: unknown; output: string }) {
  const runtime = useThreadRuntime();
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const argsJson = safeStringify(args, { indent: 2 });
    const outputPreview = truncate(output, 2000).text;
    const prompt =
      `The \`${toolName}\` tool call just failed. Please diagnose the cause and retry with corrected arguments.\n\n` +
      `args:\n\`\`\`json\n${argsJson}\n\`\`\`\n\noutput:\n\`\`\`\n${outputPreview}\n\`\`\``;
    runtime.append({ role: "user", content: [{ type: "text", text: prompt }] });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10 transition"
      title="Ask Claude to diagnose and retry"
    >
      <Wand2 className="size-3" /> fix this
    </button>
  );
}

/* ---------- Bash ---------------------------------------------------------- */

export function BashTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { command?: string; description?: string; timeout?: number };
  const command = str(args.command);
  const result = resultString(props.result);
  const lines = command.split("\n");
  const firstLine = lines[0] ?? "";

  return (
    <ToolCard
      icon={<Terminal className="size-4" />}
      name="Bash"
      summary={<span>{truncate(firstLine, 100).text}{lines.length > 1 ? " …" : ""}</span>}
      meta={args.description ? <span className="italic">{truncate(args.description, 40).text}</span> : null}
      state={state}
    >
      <ActionRow label="command">
        <CopyButton value={command} label="copy" />
      </ActionRow>
      <pre className="mx-3 mt-1 mb-2 overflow-auto rounded-md bg-black/80 text-green-300 p-2 text-[11px] font-mono leading-snug whitespace-pre-wrap">
        <span className="text-muted-foreground select-none">$ </span>{command}
      </pre>
      {(result || state === "pending") && (
        <>
          <ActionRow label={state === "pending" ? "output · streaming" : "output"}>
            {result && <CopyButton value={result} label="copy" />}
            {state === "error" && <FixErrorButton toolName="Bash" args={args} output={result} />}
          </ActionRow>
          <pre
            className={cn(
              "mx-3 mt-1 mb-3 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] font-mono leading-snug whitespace-pre-wrap",
              state === "error" && "bg-destructive/10 text-destructive",
            )}
            style={{ maxHeight: 440 }}
          >
            {result || "(no output yet)"}
          </pre>
        </>
      )}
    </ToolCard>
  );
}

/* ---------- Read ---------------------------------------------------------- */

export function ReadTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { file_path?: string; offset?: number; limit?: number };
  const path = str(args.file_path);
  const offset = typeof args.offset === "number" ? args.offset : 1;
  const range = args.offset != null || args.limit != null
    ? `L${offset}${args.limit ? `+${args.limit}` : ""}`
    : null;
  const rawResult = resultString(props.result);
  // The Read tool prefixes every line with a cat-like gutter ("   42→<text>").
  // Strip it so NumberedCode can render proper aligned line numbers starting
  // from the real offset. If stripping fails (e.g. streaming partial) we
  // fall back to raw text.
  const { text: cleaned, detectedStart } = stripReadGutter(rawResult, offset);

  return (
    <ToolCard
      icon={<FileText className="size-4" />}
      name="Read"
      summary={<span title={path}>{shortPath(path)}</span>}
      meta={
        <span className="inline-flex items-center gap-1">
          {range && <span>{range}</span>}
        </span>
      }
      state={state}
    >
      {(rawResult || state === "pending") && (
        <>
          <ActionRow label="content">
            <CopyButton value={cleaned || rawResult} label="copy" />
            <OpenInEditor path={path} line={detectedStart} />
          </ActionRow>
          {cleaned ? (
            <NumberedCode text={cleaned} startLine={detectedStart} maxH={480} language={languageFromPath(path)} />
          ) : (
            <Code maxH={440}>{rawResult || "(loading)"}</Code>
          )}
        </>
      )}
    </ToolCard>
  );
}

/**
 * Read tool output: "   42→<line content>\n   43→<…>\n".
 * Returns the bare text and the starting line (falls back to `offset`).
 */
function stripReadGutter(raw: string, offset: number): { text: string; detectedStart: number } {
  if (!raw) return { text: "", detectedStart: offset };
  const lines = raw.split("\n");
  // Accept a leading system-reminder block before the gutter starts.
  const gutterRe = /^\s*(\d+)→(.*)$/;
  const parsed: Array<{ n: number; content: string }> = [];
  for (const l of lines) {
    const m = gutterRe.exec(l);
    if (m) parsed.push({ n: Number(m[1]), content: m[2] ?? "" });
  }
  if (parsed.length === 0) return { text: "", detectedStart: offset };
  return {
    text: parsed.map((p) => p.content).join("\n"),
    detectedStart: parsed[0]!.n,
  };
}

/* ---------- Edit / Write -------------------------------------------------- */

export function EditTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
  };
  const path = str(args.file_path);
  const oldStr = str(args.old_string);
  const newStr = str(args.new_string);

  return (
    <ToolCard
      icon={<FilePenLine className="size-4" />}
      name="Edit"
      summary={<span title={path}>{shortPath(path)}</span>}
      meta={args.replace_all ? <span className="text-warning">replace_all</span> : null}
      state={state}
      defaultOpen={state !== "done"}
    >
      <ActionRow label="diff">
        <CopyButton value={newStr} label="copy new" />
        <OpenInEditor path={path} />
      </ActionRow>
      <div className="mx-3 my-2 rounded-md border bg-background overflow-auto" style={{ maxHeight: 440 }}>
        <DiffView oldText={oldStr} newText={newStr} language={languageFromPath(path)} />
      </div>
      {props.result != null && state !== "pending" && (
        <>
          <SectionLabel>result</SectionLabel>
          <Code>{resultString(props.result)}</Code>
        </>
      )}
    </ToolCard>
  );
}

export function WriteTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { file_path?: string; content?: string };
  const path = str(args.file_path);
  const content = str(args.content);
  const lineCount = content ? content.split("\n").length : 0;

  return (
    <ToolCard
      icon={<FilePenLine className="size-4" />}
      name="Write"
      summary={<span title={path}>{shortPath(path)}</span>}
      meta={lineCount > 0 ? `${lineCount} lines` : null}
      state={state}
    >
      <ActionRow label="content">
        <CopyButton value={content} label="copy" />
        <OpenInEditor path={path} />
      </ActionRow>
      {content ? (
        <HighlightedCode text={content} language={languageFromPath(path)} tone="added" />
      ) : (
        <div className="mx-3 my-2 text-[11px] text-muted-foreground italic">(empty)</div>
      )}
    </ToolCard>
  );
}

/* A minimal line-by-line diff: blocks of removed lines then added lines.
   For multiline old/new we render two adjacent blocks with red/green gutter. */
function DiffView({ oldText, newText, language }: { oldText: string; newText: string; language?: string }) {
  return (
    <div className="text-[11px] font-mono leading-snug">
      {oldText && <DiffBlock text={oldText} side="remove" language={language} />}
      {newText && <DiffBlock text={newText} side="add" language={language} />}
    </div>
  );
}

function DiffBlock({ text, side, language }: { text: string; side: "add" | "remove"; language?: string }) {
  const isAdd = side === "add";
  const Icon = isAdd ? Plus : Minus;
  const rowCls = isAdd ? "bg-success/5" : "bg-destructive/5";
  const iconCls = isAdd ? "text-success" : "text-destructive";
  // Syntax-highlight the block then splice in gutter icons per line.
  const lines = text.split("\n");
  return (
    <div>
      {/* Render the highlighted source once, using getLineProps/getTokenProps
          keyed by index, while wrapping each row with a side icon. */}
      <HighlightRows lines={lines} language={language}>
        {(renderedLine, i) => (
          <div key={`${side}-${i}`} className={cn("flex items-start", rowCls)}>
            <span className={cn("w-5 shrink-0 text-center select-none", iconCls)}>
              <Icon className="inline size-3" />
            </span>
            <span className={cn("whitespace-pre-wrap break-all pr-2 flex-1 min-w-0", iconCls)}>
              {renderedLine}
            </span>
          </div>
        )}
      </HighlightRows>
    </div>
  );
}

/** Thin wrapper around Prism that yields a rendered ReactNode per line. */
function HighlightRows({
  lines,
  language,
  children,
}: {
  lines: string[];
  language?: string;
  children: (node: React.ReactNode, index: number) => React.ReactNode;
}) {
  // Using the existing HighlightedCode API would emit a full <pre>, which
  // breaks our per-row gutter layout. Fall back to plain text; the added/
  // removed color carries the signal. Full syntax colors inside diff rows
  // would require wiring Prism tokens per-line explicitly — kept simple here.
  void language;
  return (
    <>
      {lines.map((line, i) => children(line || " ", i))}
    </>
  );
}

/* ---------- Grep ---------------------------------------------------------- */

export function GrepTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as {
    pattern?: string;
    path?: string;
    glob?: string;
    type?: string;
    output_mode?: string;
    "-i"?: boolean;
    multiline?: boolean;
  };
  const pattern = str(args.pattern);
  const result = resultString(props.result);
  const matchCount = result ? result.split("\n").filter((l) => l.trim()).length : 0;

  return (
    <ToolCard
      icon={<Search className="size-4" />}
      name="Grep"
      summary={<span className="text-primary">/{pattern}/</span>}
      meta={
        <span className="inline-flex items-center gap-2">
          {args.glob && <span>glob: {args.glob}</span>}
          {args.type && <span>type: {args.type}</span>}
          {matchCount > 0 && state !== "pending" && <span>{matchCount} matches</span>}
        </span>
      }
      state={state}
    >
      {result && (
        <>
          <ActionRow label="matches">
            <CopyButton value={pattern} label="copy pattern" />
            <CopyButton value={result} label="copy" />
          </ActionRow>
          <Code maxH={360}>{result}</Code>
        </>
      )}
    </ToolCard>
  );
}

/* ---------- Glob ---------------------------------------------------------- */

export function GlobTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { pattern?: string; path?: string };
  const result = resultString(props.result);
  const files = result ? result.split("\n").filter(Boolean) : [];

  return (
    <ToolCard
      icon={<Folder className="size-4" />}
      name="Glob"
      summary={<span>{str(args.pattern)}</span>}
      meta={files.length > 0 && state !== "pending" ? `${files.length} files` : null}
      state={state}
    >
      {files.length > 0 && (
        <>
          <ActionRow label="files">
            <CopyButton value={result} label="copy" />
          </ActionRow>
          <ul className="mx-3 my-2 space-y-0.5 overflow-auto text-[11px] font-mono" style={{ maxHeight: 320 }}>
            {files.slice(0, 200).map((f, i) => {
              const url = vscodeUrl(f);
              return (
                <li key={i} className="truncate text-muted-foreground" title={f}>
                  {url ? (
                    <a
                      href={url}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-foreground hover:underline"
                    >
                      {f}
                    </a>
                  ) : (
                    f
                  )}
                </li>
              );
            })}
            {files.length > 200 && (
              <li className="italic text-muted-foreground">… {files.length - 200} more</li>
            )}
          </ul>
        </>
      )}
    </ToolCard>
  );
}

/* ---------- TodoWrite ----------------------------------------------------- */

interface Todo {
  content?: string;
  activeForm?: string;
  status?: "pending" | "in_progress" | "completed";
}

export function TodoWriteTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { todos?: Todo[] };
  const todos = Array.isArray(args.todos) ? args.todos : [];
  const done = todos.filter((t) => t.status === "completed").length;

  return (
    <ToolCard
      icon={<CheckSquare className="size-4" />}
      name="TodoWrite"
      summary={<span>{todos.length} item{todos.length !== 1 ? "s" : ""}</span>}
      meta={todos.length > 0 ? `${done}/${todos.length} done` : null}
      state={state}
      defaultOpen
    >
      <ul className="mx-3 my-2 space-y-1 text-xs">
        {todos.map((t, i) => {
          const label = t.status === "in_progress" ? (t.activeForm ?? t.content ?? "") : (t.content ?? "");
          return (
            <li key={i} className="flex items-start gap-2">
              <TodoIcon status={t.status} />
              <span
                className={cn(
                  t.status === "completed" && "line-through text-muted-foreground",
                  t.status === "in_progress" && "font-medium text-primary",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
        {todos.length === 0 && <li className="text-muted-foreground italic">(no todos)</li>}
      </ul>
    </ToolCard>
  );
}

function TodoIcon({ status }: { status?: Todo["status"] }) {
  if (status === "completed") return <CheckSquare className="size-3.5 mt-0.5 shrink-0 text-success" />;
  if (status === "in_progress") return <ArrowRight className="size-3.5 mt-0.5 shrink-0 text-primary animate-pulse" />;
  return <Square className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />;
}

/* ---------- Web ----------------------------------------------------------- */

export function WebFetchTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { url?: string; prompt?: string };
  const url = str(args.url);
  const result = resultString(props.result);
  let host = url;
  try { host = new URL(url).host; } catch { /* not a valid URL yet */ }

  return (
    <ToolCard
      icon={<Globe className="size-4" />}
      name="WebFetch"
      summary={
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 hover:underline"
            title={url}
          >
            {host}
            <ExternalLink className="size-3" />
          </a>
        ) : null
      }
      meta={args.prompt ? <span className="italic">{truncate(args.prompt, 40).text}</span> : null}
      state={state}
    >
      {result && (
        <>
          <SectionLabel>result</SectionLabel>
          <Code maxH={360}>{result}</Code>
        </>
      )}
    </ToolCard>
  );
}

export function WebSearchTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { query?: string; allowed_domains?: string[] };
  const result = resultString(props.result);

  return (
    <ToolCard
      icon={<Globe className="size-4" />}
      name="WebSearch"
      summary={<span>"{str(args.query)}"</span>}
      meta={args.allowed_domains?.length ? `${args.allowed_domains.length} domain(s)` : null}
      state={state}
    >
      {result && (
        <>
          <SectionLabel>results</SectionLabel>
          <Code maxH={360}>{result}</Code>
        </>
      )}
    </ToolCard>
  );
}

/* ---------- Task (sub-agent) --------------------------------------------- */

export function TaskTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { subagent_type?: string; description?: string; prompt?: string };
  const subtype = str(args.subagent_type) || "general-purpose";
  const desc = str(args.description);
  const prompt = str(args.prompt);
  const result = resultString(props.result);

  return (
    <ToolCard
      icon={<Bot className="size-4" />}
      name="Task"
      summary={
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{subtype}</span>
          {desc && <span>{truncate(desc, 50).text}</span>}
        </span>
      }
      state={state}
      defaultOpen={state !== "done"}
    >
      {prompt && (
        <>
          <ActionRow label="prompt">
            <CopyButton value={prompt} label="copy" />
          </ActionRow>
          <Code maxH={240}>{prompt}</Code>
        </>
      )}
      {(result || state === "pending") && (
        <>
          <ActionRow label={state === "pending" ? "agent response · streaming" : "agent response"}>
            {result && <CopyButton value={result} label="copy" />}
          </ActionRow>
          <div className="mx-3 my-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            {result ? (
              <div className="prose-compact whitespace-pre-wrap">{result}</div>
            ) : (
              <div className="text-muted-foreground italic">sub-agent is working…</div>
            )}
          </div>
        </>
      )}
    </ToolCard>
  );
}

/* ---------- LS ------------------------------------------------------------ */

export function LsTool(props: ToolCallMessagePartProps) {
  const state = deriveToolState(props.status, props.isError);
  const args = props.args as { path?: string; ignore?: string[] };
  const result = resultString(props.result);
  return (
    <ToolCard
      icon={<Folder className="size-4" />}
      name="LS"
      summary={<span>{shortPath(str(args.path))}</span>}
      state={state}
    >
      {result && (
        <>
          <SectionLabel>entries</SectionLabel>
          <Code maxH={320}>{result}</Code>
        </>
      )}
    </ToolCard>
  );
}
