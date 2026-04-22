import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();

export interface PathValidationResult {
  ok: boolean;
  resolved?: string;
  reason?: string;
}

/**
 * Normalize + validate a filesystem path that came in from a client-controlled
 * input (REST body, WS message). Rejects traversal tricks, null bytes, and
 * paths outside the allowed roots.
 *
 * allowedRoots defaults to [home, /tmp] — you can widen via CLAUDE_CWD etc. in
 * env, but the client cannot push us past those without the operator opting in.
 */
export function validateAbsolutePath(
  input: unknown,
  allowedRoots: string[] = defaultAllowedRoots(),
): PathValidationResult {
  if (typeof input !== "string") return { ok: false, reason: "not a string" };
  if (input.length === 0) return { ok: false, reason: "empty" };
  if (input.length > 1000) return { ok: false, reason: "too long" };
  if (input.includes("\0")) return { ok: false, reason: "contains NUL" };

  const resolved = path.resolve(input);
  if (!path.isAbsolute(resolved)) return { ok: false, reason: "not absolute" };

  const inScope = (p: string) =>
    allowedRoots.some((root) => p === root || p.startsWith(root + path.sep));

  if (!inScope(resolved)) return { ok: false, reason: "outside allowed roots" };

  // If the path exists we resolve symlinks and re-check scope — prevents
  // $HOME/link → /etc bypass. If it doesn't exist, we accept the lexical
  // path (new dirs are ok; SDK will surface any deeper issue).
  try {
    const real = fs.realpathSync.native(resolved);
    if (!inScope(real)) return { ok: false, reason: "symlink escapes allowed roots" };
    const stat = fs.statSync(real);
    if (!stat.isDirectory()) return { ok: false, reason: "not a directory" };
    return { ok: true, resolved: real };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { ok: true, resolved };
    // Any other error (EACCES, EPERM, ELOOP, etc.) → reject.
    return { ok: false, reason: `fs error: ${code ?? "unknown"}` };
  }
}

export function validateDirList(
  input: unknown,
  allowedRoots: string[] = defaultAllowedRoots(),
): { ok: boolean; resolved: string[]; reason?: string } {
  if (!Array.isArray(input)) return { ok: false, resolved: [], reason: "not array" };
  const out: string[] = [];
  for (const raw of input) {
    const r = validateAbsolutePath(raw, allowedRoots);
    if (!r.ok) return { ok: false, resolved: [], reason: r.reason };
    if (r.resolved) out.push(r.resolved);
  }
  return { ok: true, resolved: out };
}

function defaultAllowedRoots(): string[] {
  // Operatör env üzerinden ek root'lar tanımlayabilir: CLAUDE_CWD tek bir
  // mutlak yol, CLAUDE_ADD_DIRS `;` ile ayrılmış liste. Sunucu tarafı
  // yapılandırma olduğu için client tarafı bir bypass vektörü değil.
  const envCwd = process.env.CLAUDE_CWD?.trim();
  const envAdd = (process.env.CLAUDE_ADD_DIRS ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const roots = [HOME, "/tmp", ...(envCwd ? [envCwd] : []), ...envAdd];
  return roots.filter((r) => r && path.isAbsolute(r));
}
