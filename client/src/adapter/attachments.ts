import type { AttachmentAdapter, PendingAttachment, CompleteAttachment } from "@assistant-ui/react";

/**
 * Unified attachment adapter for the Claude Console.
 *
 * Handles three concrete routes:
 *   - image/*          → image block (native vision, reaches the model as an image)
 *   - application/pdf  → file block (forwarded server-side as a document block)
 *   - text/* + code    → text block (inlined with a header so Claude reads it as source)
 *
 * Anything else is rejected with a clear error so the user knows why. This
 * replaces the default Composite(Simple* Simple*) because those two silently
 * drop code files whose MIME the browser reports as empty.
 */
export class ClaudeAttachmentAdapter implements AttachmentAdapter {
  // Broad accept: browsers show all files; we validate in `add`.
  accept = "*/*";

  async add(state: { file: File }): Promise<PendingAttachment> {
    const { file } = state;
    const { kind } = classify(file);
    if (kind === "unsupported") {
      const msg = `Unsupported file type: "${file.name}" (${file.type || "unknown"}). Allowed: images, PDF, text/source files.`;
      emitAttachmentError(msg);
      throw new Error(msg);
    }
    if (file.size > MAX_BYTES) {
      const msg = `File too large: "${file.name}" is ${formatBytes(file.size)}. Max ${formatBytes(MAX_BYTES)} per attachment.`;
      emitAttachmentError(msg);
      throw new Error(msg);
    }
    return {
      id: `${file.name}-${file.lastModified}-${file.size}`,
      type: kind === "image" ? "image" : kind === "pdf" ? "file" : "document",
      name: file.name,
      contentType: file.type || guessMime(file.name),
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const { file } = attachment;
    const { kind, mime } = classify(file);

    if (kind === "image") {
      return {
        ...attachment,
        status: { type: "complete" },
        content: [{ type: "image", image: await readAsDataURL(file) }],
      };
    }

    if (kind === "pdf") {
      // Represent as "file" content part with data-URL payload. Our chat
      // adapter recognises mimeType=application/pdf and promotes it to the
      // SDK's document content block on the server side.
      return {
        ...attachment,
        status: { type: "complete" },
        content: [
          {
            type: "file",
            filename: file.name,
            mimeType: mime,
            data: await readAsDataURL(file),
          },
        ],
      };
    }

    // Text / source file — inline with a header Claude can parse visually.
    const text = await readAsText(file);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "text",
          text: `<attachment name=${file.name} mime=${mime}>\n${text}\n</attachment>`,
        },
      ],
    };
  }

  async remove(): Promise<void> {
    /* nothing to clean up — we hold no external handles */
  }
}

/* ---------- classification ------------------------------------------------ */

type Kind = "image" | "pdf" | "text" | "unsupported";

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/yaml", "application/toml"];

// Extensions that are almost always plain text but whose MIME browsers often
// report as empty. Keeping this list tight but covering the common dev-file
// surface area.
const TEXT_EXTS = new Set([
  "txt", "log", "md", "markdown", "mdx",
  "json", "jsonc", "json5", "ndjson",
  "yaml", "yml", "toml", "ini", "env", "conf", "cfg",
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "pyi", "rb", "go", "rs", "java", "kt", "swift",
  "c", "h", "cc", "hh", "cpp", "hpp", "cs", "m", "mm",
  "php", "lua", "pl", "scala", "clj", "hs", "ml", "sh", "bash", "zsh", "fish",
  "sql", "graphql", "gql",
  "html", "htm", "xml", "svg",
  "css", "scss", "sass", "less", "styl",
  "vue", "svelte", "astro",
  "dockerfile",
  "gitignore", "gitattributes",
  "csv", "tsv",
  "diff", "patch",
]);

function classify(file: File): { kind: Kind; mime: string } {
  const mime = (file.type || "").toLowerCase();
  if (IMAGE_MIMES.has(mime)) return { kind: "image", mime };
  if (mime === "application/pdf") return { kind: "pdf", mime };
  if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return { kind: "text", mime: mime || "text/plain" };
  // Fallback on extension — browsers often hand us "" for code files.
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (TEXT_EXTS.has(ext)) return { kind: "text", mime: guessMime(file.name) };
  return { kind: "unsupported", mime };
}

function guessMime(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "md": case "markdown": case "mdx": return "text/markdown";
    case "json": case "jsonc": case "json5": return "application/json";
    case "yaml": case "yml": return "application/yaml";
    case "toml": return "application/toml";
    case "csv": return "text/csv";
    case "html": case "htm": return "text/html";
    case "xml": case "svg": return "application/xml";
    case "css": case "scss": case "sass": case "less": return "text/css";
    default: return "text/plain";
  }
}

/* ---------- helpers ------------------------------------------------------- */

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB raw — matches server 10 MB base64 cap

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("readAsDataURL failed"));
    reader.readAsDataURL(file);
  });
}

/** Broadcast attachment errors so the Composer can display a banner. */
export const ATTACHMENT_ERROR_EVENT = "claude-console:attachment-error";
function emitAttachmentError(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ATTACHMENT_ERROR_EVENT, { detail: { message } }));
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("readAsText failed"));
    reader.readAsText(file);
  });
}
