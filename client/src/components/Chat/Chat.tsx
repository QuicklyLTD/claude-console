import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  AttachmentPrimitive,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ClaudeAttachmentAdapter, ATTACHMENT_ERROR_EVENT } from "@/adapter/attachments";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, StopCircle, Sparkles, Copy, Check, Pencil, RotateCcw, ChevronLeft, ChevronRight, ArrowDown, AlertCircle, Plus, FileText as FileTextIcon, X as XIcon } from "lucide-react";
import type { UISessionRow } from "@shared/protocol";
import { cn } from "@/lib/utils";
import { makeClaudeAdapter } from "@/adapter/claudeAdapter";
import type { AgentSocketApi } from "@/hooks/useAgentSocket";
import { ToolCallBlock } from "./ToolCallBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { toolRenderersByName, ToolGroup } from "./tools";
import { api } from "@/lib/api";
import { extractText } from "@/lib/utils";

interface Props {
  session: UISessionRow;
  socket: AgentSocketApi;
}

export function Chat({ session, socket }: Props) {
  const [initial, setInitial] = useState<ThreadMessageLike[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoaded(false);
      const detail = await api.getSession(session.id).catch(() => null);
      if (!alive) return;
      if (detail?.sdkMessages?.length) {
        setInitial(sdkMessagesToInitial(detail.sdkMessages));
      } else {
        setInitial([]);
      }
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [session.id]);

  const adapter = useMemo(
    () => makeClaudeAdapter({
      startTurn: (text, attachments) => socket.startTurn(text, attachments),
      interrupt: () => socket.interrupt(),
    }),
    [socket],
  );

  if (!loaded) {
    return <div className="flex-1 grid place-items-center text-muted-foreground text-sm">loading…</div>;
  }

  return <ChatInner key={session.id} initial={initial} adapter={adapter} session={session} />;
}

function ChatInner({
  initial,
  adapter,
  session,
}: {
  initial: ThreadMessageLike[];
  adapter: ReturnType<typeof makeClaudeAdapter>;
  session: UISessionRow;
}) {
  const runtime = useLocalRuntime(adapter, {
    initialMessages: initial,
    adapters: {
      attachments: new ClaudeAttachmentAdapter(),
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex-1 flex min-h-0 flex-col bg-background">
        <ThreadPrimitive.Viewport className="flex-1 min-h-0 overflow-y-auto relative">
          <div className="mx-auto w-full max-w-3xl px-6 py-8 space-y-8">
            <ThreadPrimitive.Empty>
              <EmptyState session={session} />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
              }}
            />
          </div>
          <ThreadPrimitive.ScrollToBottom
            className={cn(
              "absolute bottom-4 left-1/2 -translate-x-1/2 z-10",
              "inline-flex items-center justify-center size-8 rounded-full border bg-background shadow-sm",
              "text-muted-foreground hover:text-foreground hover:bg-muted transition",
              "disabled:opacity-0 disabled:pointer-events-none",
            )}
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="size-4" />
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
        <div className="bg-gradient-to-t from-background via-background to-transparent pt-2">
          <div className="mx-auto w-full max-w-3xl px-6 pb-4">
            <Composer />
          </div>
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function EmptyState({ session }: { session: UISessionRow }) {
  return (
    <div className="mx-auto max-w-xl text-center pt-24 pb-12">
      <div className="mx-auto size-14 rounded-full bg-primary/10 text-primary grid place-items-center mb-6">
        <Sparkles className="size-7" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">How can I help you today?</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
        Ask Claude to read the codebase, run commands, scaffold features or refactor existing code.
        {session.workingDir ? <> Operating in <code className="font-mono text-xs bg-muted rounded px-1 py-0.5">{session.workingDir}</code>.</> : null}
      </p>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="group">
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1 max-w-[80%] min-w-0">
          <ComposerPrimitive.If editing={false}>
            <MessagePrimitive.Attachments
              components={{
                Image: AttachmentChip,
                Document: AttachmentChip,
                File: AttachmentChip,
              }}
            />
            <div className="rounded-3xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
              <MessagePrimitive.Content />
            </div>
          </ComposerPrimitive.If>
          <ComposerPrimitive.If editing>
            <EditComposer />
          </ComposerPrimitive.If>
          <UserActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function EditComposer() {
  return (
    <ComposerPrimitive.Root className="w-full min-w-[280px] flex flex-col gap-2 rounded-2xl border bg-background p-3">
      <ComposerPrimitive.Input
        autoFocus
        rows={2}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground max-h-60"
      />
      <div className="flex justify-end gap-2">
        <ComposerPrimitive.Cancel
          className={cn(
            "inline-flex items-center justify-center h-7 px-3 rounded-md text-xs",
            "bg-secondary text-secondary-foreground hover:bg-secondary/80 transition",
          )}
        >
          Cancel
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send
          className={cn(
            "inline-flex items-center justify-center h-7 px-3 rounded-md text-xs",
            "bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-40",
          )}
        >
          Save & resubmit
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

const actionBtnCls =
  "inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition disabled:opacity-40 disabled:cursor-not-allowed";

function UserActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 data-[floating]:opacity-100 transition-opacity"
    >
      <ActionBarPrimitive.Edit className={actionBtnCls} aria-label="Edit message">
        <Pencil className="size-3.5" />
      </ActionBarPrimitive.Edit>
      <ActionBarPrimitive.Copy className={actionBtnCls} aria-label="Copy message">
        <MessagePrimitive.If copied>
          <Check className="size-3.5 text-success" />
        </MessagePrimitive.If>
        <MessagePrimitive.If copied={false}>
          <Copy className="size-3.5" />
        </MessagePrimitive.If>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
}

function AssistantActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 data-[floating]:opacity-100 transition-opacity"
    >
      <ActionBarPrimitive.Copy className={actionBtnCls} aria-label="Copy response">
        <MessagePrimitive.If copied>
          <Check className="size-3.5 text-success" />
        </MessagePrimitive.If>
        <MessagePrimitive.If copied={false}>
          <Copy className="size-3.5" />
        </MessagePrimitive.If>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload className={actionBtnCls} aria-label="Regenerate">
        <RotateCcw className="size-3.5" />
      </ActionBarPrimitive.Reload>
      <BranchPicker />
    </ActionBarPrimitive.Root>
  );
}

function BranchPicker() {
  return (
    <MessagePrimitive.If hasBranches>
      <BranchPickerPrimitive.Root
        hideWhenSingleBranch
        className="inline-flex items-center gap-0.5 ml-1 text-[11px] text-muted-foreground"
      >
        <BranchPickerPrimitive.Previous className={actionBtnCls} aria-label="Previous branch">
          <ChevronLeft className="size-3.5" />
        </BranchPickerPrimitive.Previous>
        <span className="tabular-nums font-mono">
          <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
        </span>
        <BranchPickerPrimitive.Next className={actionBtnCls} aria-label="Next branch">
          <ChevronRight className="size-3.5" />
        </BranchPickerPrimitive.Next>
      </BranchPickerPrimitive.Root>
    </MessagePrimitive.If>
  );
}

function AssistantText({ text }: { text: string }) {
  if (!text) return null;
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="prose-compact" />;
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group">
      <div className="flex gap-4">
        <div className="size-7 shrink-0 rounded-full bg-primary/15 text-primary grid place-items-center mt-1">
          <Sparkles className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm prose-compact">
            <MessagePrimitive.Content
              components={{
                Text: AssistantText,
                Reasoning: ThinkingBlock,
                tools: { by_name: toolRenderersByName, Fallback: ToolCallBlock },
                ToolGroup,
              }}
            />
            <MessagePrimitive.Error>
              <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 text-destructive p-2 text-xs">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                <div>Generation failed. Use the regenerate button to retry.</div>
              </div>
            </MessagePrimitive.Error>
          </div>
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex flex-col gap-2 rounded-3xl border bg-background px-4 py-3 shadow-sm focus-within:border-ring/70 focus-within:shadow-md transition">
      <AttachmentErrorBanner />
      <ComposerPrimitive.Attachments
        components={{
          Image: AttachmentChip,
          Document: AttachmentChip,
          File: AttachmentChip,
        }}
      />
      <ComposerPrimitive.Input
        autoFocus
        rows={1}
        placeholder="Send a message…"
        className="w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-muted-foreground max-h-60 min-h-[1.5rem]"
      />
      <div className="flex items-center justify-between">
        <ComposerPrimitive.AddAttachment
          multiple
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-muted/60 transition disabled:opacity-40",
          )}
          aria-label="Attach file"
        >
          <Plus className="size-3.5" /> Attach
        </ComposerPrimitive.AddAttachment>

        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
              "disabled:opacity-30 hover:opacity-90 transition",
            )}
            aria-label="Send message"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:opacity-90 transition"
            aria-label="Stop"
          >
            <StopCircle className="size-4" />
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </div>
    </ComposerPrimitive.Root>
  );
}

function AttachmentErrorBanner() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string }>).detail;
      setMsg(detail?.message ?? "Attachment rejected.");
    };
    window.addEventListener(ATTACHMENT_ERROR_EVENT, handler);
    return () => window.removeEventListener(ATTACHMENT_ERROR_EVENT, handler);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 text-destructive p-2 text-xs">
      <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">{msg}</div>
      <button
        type="button"
        onClick={() => setMsg(null)}
        aria-label="Dismiss"
        className="ml-2 text-destructive/70 hover:text-destructive"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

function AttachmentChip() {
  return (
    <AttachmentPrimitive.Root className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 pl-1.5 pr-1 py-1 text-xs max-w-[220px]">
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono">
        <AttachmentPrimitive.Name />
      </span>
      <AttachmentPrimitive.Remove
        className="inline-flex items-center justify-center size-5 rounded hover:bg-muted transition"
        aria-label="Remove attachment"
      >
        <XIcon className="size-3" />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

/* --------------------- initial-messages adapter -------------------------- */

interface SdkMsgLike {
  type?: string;
  message?: { role?: string; content?: unknown };
}

interface BlockLike {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  thinking?: string;
}

type AssistantPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      argsText?: string;
      result?: unknown;
      isError?: boolean;
    };

/**
 * Rehydrate ThreadMessageLike[] from SDK JSONL using native content parts.
 * tool_result blocks found inside synthetic "user" messages are spliced into
 * the matching assistant tool-call part.
 */
function sdkMessagesToInitial(raw: unknown[]): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  type AssistantEntry = { role: "assistant"; content: AssistantPart[]; id: string };
  const toolIndex = new Map<string, { msg: AssistantEntry; blockIndex: number }>();

  for (const m of raw as SdkMsgLike[]) {
    if (!m || typeof m !== "object") continue;

    if (m.type === "user" && m.message?.role === "user") {
      const blocks = Array.isArray(m.message.content) ? (m.message.content as BlockLike[]) : [];
      let hadToolResult = false;
      for (const b of blocks) {
        if (b?.type === "tool_result") {
          hadToolResult = true;
          const id = String(b.tool_use_id ?? "");
          const ref = toolIndex.get(id);
          if (!ref) continue;
          const existing = ref.msg.content[ref.blockIndex];
          if (existing?.type !== "tool-call") continue;
          ref.msg.content[ref.blockIndex] = {
            ...existing,
            result: extractText(b.content),
            isError: Boolean(b.is_error),
          };
        }
      }
      if (hadToolResult) continue;

      const t = extractText(m.message.content);
      if (t) out.push({ id: crypto.randomUUID(), role: "user", content: [{ type: "text", text: t }] });
      continue;
    }

    if (m.type === "assistant" && m.message?.role === "assistant") {
      const blocks = Array.isArray(m.message.content) ? (m.message.content as BlockLike[]) : [];
      const newParts: AssistantPart[] = [];
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string") {
          newParts.push({ type: "text", text: b.text });
        } else if (b.type === "tool_use") {
          const args = (b.input ?? {}) as Record<string, unknown>;
          newParts.push({
            type: "tool-call",
            toolCallId: String(b.id ?? ""),
            toolName: String(b.name ?? "tool"),
            args,
            argsText: safeJson(args),
          });
        } else if (b.type === "thinking" && typeof b.thinking === "string") {
          newParts.push({ type: "reasoning", text: b.thinking });
        }
      }
      if (newParts.length === 0) continue;

      // Coalesce consecutive SDK assistant messages into a single UI assistant
      // message. SDK-side, Claude streams each text/tool_use block as its own
      // {type:"assistant"} event, so one user turn produces N back-to-back
      // assistant events. Merging them keeps live-streaming parity and lets
      // assistant-ui's ToolGroup wrap consecutive tool-calls correctly.
      const prev = out[out.length - 1] as (AssistantEntry | undefined);
      if (prev && prev.role === "assistant") {
        const offset = prev.content.length;
        prev.content.push(...newParts);
        newParts.forEach((block, idx) => {
          if (block.type === "tool-call") {
            toolIndex.set(block.toolCallId, { msg: prev, blockIndex: offset + idx });
          }
        });
        continue;
      }

      const entry: AssistantEntry = { role: "assistant", content: [...newParts], id: crypto.randomUUID() };
      out.push(entry as ThreadMessageLike);
      entry.content.forEach((block, idx) => {
        if (block.type === "tool-call") {
          toolIndex.set(block.toolCallId, { msg: entry, blockIndex: idx });
        }
      });
    }
  }
  return out;
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return "{}"; }
}
