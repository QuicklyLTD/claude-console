import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { UISessionRow } from "@shared/protocol.js";
import { DATA_DIR } from "./config.js";

const DB_PATH = path.join(DATA_DIR, "console.db");
fs.mkdirSync(DATA_DIR, { recursive: true });

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ui_sessions (
  id TEXT PRIMARY KEY,
  sdk_session_id TEXT,
  title TEXT NOT NULL,
  working_dir TEXT,
  additional_directories TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'default',
  system_prompt_append TEXT,
  max_turns INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  total_turns INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ui_sessions_updated ON ui_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ui_sessions_sdk ON ui_sessions(sdk_session_id);
`;

interface SessionDbRow {
  id: string;
  sdk_session_id: string | null;
  title: string;
  working_dir: string | null;
  additional_directories: string;
  model: string | null;
  permission_mode: string;
  system_prompt_append: string | null;
  max_turns: number | null;
  tags: string;
  pinned: number;
  color: string | null;
  created_at: number;
  updated_at: number;
  total_cost_usd: number;
  total_turns: number;
  total_output_tokens: number;
}

function rowToSession(r: SessionDbRow): UISessionRow {
  return {
    id: r.id,
    sdkSessionId: r.sdk_session_id,
    title: r.title,
    workingDir: r.working_dir,
    additionalDirectories: safeJson(r.additional_directories, []),
    model: r.model,
    permissionMode: r.permission_mode as PermissionMode,
    systemPromptAppend: r.system_prompt_append,
    maxTurns: r.max_turns,
    tags: safeJson(r.tags, []),
    pinned: !!r.pinned,
    color: r.color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalCostUsd: r.total_cost_usd,
    totalTurns: r.total_turns,
    totalOutputTokens: r.total_output_tokens,
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export interface CreateSessionInput {
  title?: string;
  workingDir?: string | null;
  additionalDirectories?: string[];
  model?: string | null;
  permissionMode?: PermissionMode;
  systemPromptAppend?: string | null;
  maxTurns?: number | null;
  tags?: string[];
  pinned?: boolean;
  color?: string | null;
}

export function createUiSession(input: CreateSessionInput = {}): UISessionRow {
  const d = getDb();
  const now = Date.now();
  const id = nanoid(12);
  const title = input.title?.trim() || "New conversation";
  d.prepare(
    `INSERT INTO ui_sessions (
       id, sdk_session_id, title, working_dir, additional_directories, model,
       permission_mode, system_prompt_append, max_turns, tags, pinned, color,
       created_at, updated_at, total_cost_usd, total_turns, total_output_tokens
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
  ).run(
    id,
    title,
    input.workingDir ?? null,
    JSON.stringify(input.additionalDirectories ?? []),
    input.model ?? null,
    input.permissionMode ?? "default",
    input.systemPromptAppend ?? null,
    input.maxTurns ?? null,
    JSON.stringify(input.tags ?? []),
    input.pinned ? 1 : 0,
    input.color ?? null,
    now,
    now,
  );
  return getUiSession(id)!;
}

export function getUiSession(id: string): UISessionRow | null {
  const r = getDb().prepare<[string], SessionDbRow>(`SELECT * FROM ui_sessions WHERE id = ?`).get(id);
  return r ? rowToSession(r) : null;
}

export function listUiSessions(): UISessionRow[] {
  const rows = getDb()
    .prepare<[], SessionDbRow>(`SELECT * FROM ui_sessions ORDER BY pinned DESC, updated_at DESC`)
    .all();
  return rows.map(rowToSession);
}

export function deleteUiSession(id: string): boolean {
  return getDb().prepare(`DELETE FROM ui_sessions WHERE id = ?`).run(id).changes > 0;
}

/**
 * Column whitelist for patching — maps camelCase fields to SQL columns and
 * serializers. Only fields present in `patch` will be updated.
 */
const PATCH_COLUMNS: Record<string, { col: string; serialize?: (v: unknown) => unknown }> = {
  sdkSessionId: { col: "sdk_session_id" },
  title: { col: "title" },
  workingDir: { col: "working_dir" },
  additionalDirectories: { col: "additional_directories", serialize: (v) => JSON.stringify(v ?? []) },
  model: { col: "model" },
  permissionMode: { col: "permission_mode" },
  systemPromptAppend: { col: "system_prompt_append" },
  maxTurns: { col: "max_turns" },
  tags: { col: "tags", serialize: (v) => JSON.stringify(v ?? []) },
  pinned: { col: "pinned", serialize: (v) => (v ? 1 : 0) },
  color: { col: "color" },
  totalCostUsd: { col: "total_cost_usd" },
  totalTurns: { col: "total_turns" },
  totalOutputTokens: { col: "total_output_tokens" },
};

/**
 * Patch only the columns present in `patch`. Atomic single-UPDATE — other
 * concurrent patches cannot overwrite untouched columns with stale values.
 */
export function patchUiSession(
  id: string,
  patch: Partial<Omit<UISessionRow, "id" | "createdAt">>,
): UISessionRow | null {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) continue;
    const col = PATCH_COLUMNS[key];
    if (!col) continue;
    sets.push(`${col.col} = ?`);
    vals.push(col.serialize ? col.serialize(rawValue) : rawValue);
  }
  // No meaningful columns to patch → return current row unchanged without
  // touching `updated_at` (avoids misleading "updated" telemetry).
  if (sets.length === 0) return getUiSession(id);

  sets.push(`updated_at = ?`);
  vals.push(Date.now());
  vals.push(id);

  const sql = `UPDATE ui_sessions SET ${sets.join(", ")} WHERE id = ?`;
  const info = getDb().prepare(sql).run(...(vals as readonly unknown[] as never[]));
  if (info.changes === 0) return null;
  return getUiSession(id);
}

/**
 * Single-UPDATE increment — no race window between SELECT and UPDATE.
 */
export function accumulateUsage(
  id: string,
  delta: { costUsd: number; turns: number; outputTokens: number; sdkSessionId?: string | null },
): UISessionRow | null {
  const d = getDb();
  const now = Date.now();
  const info = delta.sdkSessionId !== undefined
    ? d.prepare(
        `UPDATE ui_sessions SET
           total_cost_usd = total_cost_usd + ?,
           total_turns = total_turns + ?,
           total_output_tokens = total_output_tokens + ?,
           sdk_session_id = COALESCE(sdk_session_id, ?),
           updated_at = ?
         WHERE id = ?`,
      ).run(delta.costUsd, delta.turns, delta.outputTokens, delta.sdkSessionId, now, id)
    : d.prepare(
        `UPDATE ui_sessions SET
           total_cost_usd = total_cost_usd + ?,
           total_turns = total_turns + ?,
           total_output_tokens = total_output_tokens + ?,
           updated_at = ?
         WHERE id = ?`,
      ).run(delta.costUsd, delta.turns, delta.outputTokens, now, id);
  if (info.changes === 0) return null;
  return getUiSession(id);
}
