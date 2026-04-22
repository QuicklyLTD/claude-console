import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict } from "date-fns";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelative(ts: number | string | Date): string {
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
  } catch {
    return "";
  }
}

export function formatCost(usd: number, digits = 4): string {
  if (!Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.0001) return `<$0.0001`;
  return `$${usd.toFixed(digits)}`;
}

export function formatTokens(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
}

export function shortJson(v: unknown, max = 160): string {
  const s = safeStringify(v, { indent: 0 });
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Cycle-safe JSON.stringify that never throws and never invokes user-supplied
 * toString/getters outside of the structured JSON path. Circular references
 * are replaced with "[Circular]". Own-property-only (no prototype walk).
 */
export function safeStringify(v: unknown, opts: { indent?: number } = {}): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(v, (_key, val) => {
      if (typeof val === "bigint") return val.toString();
      if (val && typeof val === "object") {
        if (seen.has(val as object)) return "[Circular]";
        seen.add(val as object);
      }
      return val;
    }, opts.indent ?? 2);
  } catch {
    return "(unserializable)";
  }
}

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((b: unknown) => {
      if (b && typeof b === "object" && "type" in b && (b as { type?: string }).type === "text") {
        return String((b as { text?: unknown }).text ?? "");
      }
      if (typeof b === "string") return b;
      return JSON.stringify(b);
    })
    .join("\n");
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: never[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

/**
 * Canonical session ordering: pinned first, then by updatedAt DESC.
 * Used in the sidebar and the session picker so both views agree.
 */
export function compareSessions(
  a: { pinned: boolean; updatedAt: number },
  b: { pinned: boolean; updatedAt: number },
): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}
