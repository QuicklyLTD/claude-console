import * as pty from "node-pty";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorLog } from "./logger.js";

const log = errorLog("term");

/**
 * node-pty ships a `spawn-helper` binary inside its prebuilds directory.
 * Some npm extract paths (esp. workspaces) drop the +x bit — `pty.spawn`
 * then fails with `posix_spawnp failed.`. We fix the bit at boot so the
 * problem self-heals on every fresh install.
 */
function ensureSpawnHelperExecutable(): void {
  if (process.platform === "win32") return;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    let ptyDir: string | null = null;
    for (let dir = here; dir.length > 1; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", "node-pty");
      if (fs.existsSync(candidate)) { ptyDir = candidate; break; }
    }
    if (!ptyDir) return;
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const platform = process.platform === "darwin" ? "darwin" : "linux";
    const helper = path.join(ptyDir, "prebuilds", `${platform}-${arch}`, "spawn-helper");
    if (!fs.existsSync(helper)) return;
    const stat = fs.statSync(helper);
    if ((stat.mode & 0o111) === 0) {
      fs.chmodSync(helper, stat.mode | 0o755);
      log.info({ helper }, "fixed spawn-helper +x");
    }
  } catch (err) {
    log.warn({ err: String(err) }, "ensureSpawnHelperExecutable failed");
  }
}
ensureSpawnHelperExecutable();

export interface TermSink {
  onOutput: (data: string) => void;
  onEvent: (event: "opened" | "exited" | "error", opts?: { exitCode?: number; message?: string }) => void;
}

export interface TermOpts {
  cwd: string | null;
  cols: number;
  rows: number;
  sink: TermSink;
}

/**
 * Wraps a single node-pty instance for one UI session's terminal panel.
 * Lifetime: open → many inputs/outputs → close (or peer-disconnect).
 * The same pty lives across WS reconnects — it's owned by the session.
 */
export class Terminal {
  #pty: pty.IPty | null = null;
  #closed = false;
  readonly cwd: string;

  constructor(private opts: TermOpts) {
    this.cwd = opts.cwd ?? os.homedir();
  }

  start(): void {
    if (this.#pty) return;
    // Prefer login shell so user's aliases / PATH are loaded.
    const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
    const args = process.platform === "win32" ? [] : ["-l"];
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
      // Ensure PATH has system defaults + the running Node's bin (so
      // user-installed CLI tools like `claude`, `npm`, `node` resolve
      // even if the server itself was launched from a stripped env).
      // The shell's own .zprofile / .bashrc still appends its bits on top.
      PATH: buildPath(process.env.PATH),
    };

    try {
      this.#pty = pty.spawn(shell, args, {
        name: "xterm-256color",
        cols: clampCols(this.opts.cols),
        rows: clampRows(this.opts.rows),
        cwd: this.cwd,
        env,
      });
    } catch (err) {
      log.error({ err: String(err), cwd: this.cwd }, "pty spawn failed");
      this.opts.sink.onEvent("error", { message: `shell spawn failed: ${String(err)}` });
      return;
    }

    this.#pty.onData((data) => {
      if (!this.#closed) this.opts.sink.onOutput(data);
    });
    this.#pty.onExit(({ exitCode }) => {
      if (!this.#closed) {
        this.opts.sink.onEvent("exited", { exitCode });
      }
      this.#pty = null;
    });

    this.opts.sink.onEvent("opened");
    log.info({ shell, cwd: this.cwd, pid: this.#pty.pid }, "pty opened");
  }

  write(data: string): void {
    if (!this.#pty || this.#closed) return;
    try { this.#pty.write(data); }
    catch (err) { log.warn({ err: String(err) }, "pty write failed"); }
  }

  resize(cols: number, rows: number): void {
    if (!this.#pty || this.#closed) return;
    try { this.#pty.resize(clampCols(cols), clampRows(rows)); }
    catch (err) { log.warn({ err: String(err) }, "pty resize failed"); }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pty) {
      try { this.#pty.kill(); }
      catch { /* ignore */ }
      this.#pty = null;
    }
  }
}

function clampCols(n: number): number {
  return Math.min(500, Math.max(20, Math.floor(n) || 80));
}
function clampRows(n: number): number {
  return Math.min(200, Math.max(5, Math.floor(n) || 24));
}

/**
 * Build a sane PATH for the spawned shell. Prepends:
 *   - the running Node's bin (covers nvm/fnm/volta) so `node`, `npm`, and
 *     anything installed under that node version (e.g. `claude`) resolve
 *   - system defaults (/usr/local/bin, /opt/homebrew/bin, /usr/bin, /bin, …)
 * Then appends whatever PATH the server already had so we don't lose anything.
 * Login-shell startup (.zprofile/path_helper) extends further.
 */
function buildPath(existing: string | undefined): string {
  const segs: string[] = [];
  // 1) Node bin first — most user CLIs (claude, tsx, vite, etc.) live here
  try { segs.push(path.dirname(process.execPath)); } catch { /* noop */ }
  // 2) System defaults
  if (process.platform !== "win32") {
    segs.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  }
  // 3) Existing PATH (de-duped against above)
  for (const p of (existing ?? "").split(":").filter(Boolean)) {
    if (!segs.includes(p)) segs.push(p);
  }
  return segs.join(":");
}
