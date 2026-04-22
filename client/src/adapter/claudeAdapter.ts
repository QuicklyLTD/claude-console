import type { ChatModelAdapter } from "@assistant-ui/react";
import type {
  TextMessagePart,
  ReasoningMessagePart,
  ToolCallMessagePart,
  ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PromptAttachment } from "@shared/protocol";
import type { AsyncEmitter } from "@/lib/emitter";
import { extractText } from "@/lib/utils";

interface AdapterDeps {
  startTurn: (text: string, attachments?: PromptAttachment[]) => AsyncEmitter<SDKMessage>;
  interrupt: () => void;
}

/**
 * assistant-ui ChatModelAdapter → persistent WS bridge.
 *
 * Emits native content parts:
 *   - text            → assistant prose
 *   - reasoning       → extended-thinking blocks
 *   - tool-call       → tool_use (+ matched tool_result as `result` / `isError`)
 *
 * Order is preserved: we append parts in arrival order and update the tool
 * entry in place when its tool_result arrives.
 */
export function makeClaudeAdapter(deps: AdapterDeps): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const last = messages[messages.length - 1];
      if (!last || last.role !== "user") return;
      const text = last.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n")
        .trim();

      // Convert attachment content parts to wire-protocol attachments so the
      // server can forward them to the SDK as native content blocks (images
      // reach the model; text is inlined on the server side).
      const wireAttachments: PromptAttachment[] = [];
      for (const att of last.attachments ?? []) {
        for (const part of att.content ?? []) {
          if (part.type === "image") {
            // part.image is either a data-URL ("data:image/png;base64,...") or
            // a raw URL. SimpleImageAttachmentAdapter produces data-URLs.
            const parsed = parseDataUrl(part.image);
            if (parsed) {
              wireAttachments.push({
                kind: "image",
                name: att.name,
                mimeType: parsed.mimeType,
                data: parsed.base64,
                encoding: "base64",
              });
            }
          } else if (part.type === "text") {
            wireAttachments.push({
              kind: "text",
              name: att.name,
              mimeType: "text/plain",
              data: part.text,
              encoding: "utf8",
            });
          } else if (part.type === "file") {
            // Data URL base64 file.
            const parsed = parseDataUrl(part.data);
            wireAttachments.push({
              kind: "file",
              name: att.name,
              mimeType: part.mimeType,
              data: parsed?.base64 ?? part.data,
              encoding: "base64",
            });
          }
        }
      }

      // Empty text is OK when there are attachments — a pure "here's an image"
      // turn is valid. Only skip if there's neither.
      if (!text && wireAttachments.length === 0) return;
      const promptText = text || "(attachment sent)";

      const emitter = deps.startTurn(promptText, wireAttachments.length ? wireAttachments : undefined);
      const onAbort = () => deps.interrupt();
      abortSignal.addEventListener("abort", onAbort);

      const content: ThreadAssistantMessagePart[] = [];
      let curText: { type: "text"; text: string } | null = null;

      /** toolCallId → index in `content` so tool_result can patch it. */
      const toolIndex = new Map<string, number>();

      const yieldFrame = () => ({ content: content.slice() });

      try {
        for await (const msg of emitter) {
          if (msg.type === "assistant") {
            const blocks = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
            for (const b of blocks as Array<Record<string, unknown>>) {
              if (b.type === "text" && typeof b.text === "string") {
                if (!curText) {
                  curText = { type: "text", text: "" };
                  content.push(curText as TextMessagePart);
                }
                curText.text += b.text;
                yield yieldFrame();
              } else if (b.type === "tool_use") {
                curText = null;
                const id = String(b.id ?? "");
                const name = String(b.name ?? "tool");
                const args = (b.input ?? {}) as never;
                const part: ToolCallMessagePart = {
                  type: "tool-call",
                  toolCallId: id,
                  toolName: name,
                  args,
                  argsText: safeJson(b.input),
                };
                const idx = content.push(part) - 1;
                toolIndex.set(id, idx);
                yield yieldFrame();
              } else if (b.type === "thinking" && typeof b.thinking === "string") {
                curText = null;
                const part: ReasoningMessagePart = { type: "reasoning", text: b.thinking };
                content.push(part);
                yield yieldFrame();
              }
            }
          } else if (msg.type === "user") {
            const blocks = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
            if (Array.isArray(blocks)) {
              for (const b of blocks as Array<Record<string, unknown>>) {
                if (b.type === "tool_result") {
                  const id = String(b.tool_use_id ?? "");
                  const output = extractText(b.content);
                  const isError = Boolean(b.is_error);
                  const idx = toolIndex.get(id);
                  if (idx != null && content[idx]?.type === "tool-call") {
                    const existing = content[idx] as ToolCallMessagePart;
                    content[idx] = {
                      ...existing,
                      result: output,
                      isError,
                    };
                  } else {
                    // Orphan tool_result: render a synthetic tool-call part.
                    content.push({
                      type: "tool-call",
                      toolCallId: id,
                      toolName: "(tool)",
                      args: {},
                      argsText: "{}",
                      result: output,
                      isError,
                    });
                  }
                  curText = null;
                  yield yieldFrame();
                }
              }
            }
          } else if (msg.type === "result") {
            curText = null;
          }
        }
      } finally {
        abortSignal.removeEventListener("abort", onAbort);
      }
    },
  };
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return "{}"; }
}

/** Parse "data:<mime>;base64,<payload>" into { mimeType, base64 }. */
function parseDataUrl(url: string): { mimeType: string; base64: string } | null {
  if (typeof url !== "string") return null;
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!m) return null;
  return { mimeType: m[1]!, base64: m[2]! };
}
