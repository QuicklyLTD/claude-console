import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Project root (claude-console/) regardless of dev/prod layout. */
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const LOG_DIR = path.join(DATA_DIR, "logs");

function num(v: string | undefined, fallback?: number): number | undefined {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function listSep(v: string | undefined, sep = ";"): string[] {
  return (v ?? "")
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ServerConfig {
  port: number;
  host: string;
  defaultCwd: string | null;
  defaultModel: string | null;
  defaultPermissionMode: PermissionMode;
  defaultAdditionalDirs: string[];
  defaultMaxTurns: number | null;
  bridgeToken: string | null;
  logLevel: "debug" | "info" | "warn" | "error";
  clientDistDir: string;
}

export function loadConfig(): ServerConfig {
  const clientDist = path.join(PROJECT_ROOT, "client", "dist");
  return {
    port: num(process.env.PORT, 5180)!,
    host: process.env.HOST || "127.0.0.1",
    defaultCwd: process.env.CLAUDE_CWD?.trim() || null,
    defaultModel: process.env.CLAUDE_MODEL?.trim() || null,
    defaultPermissionMode: (process.env.CLAUDE_PERMISSION_MODE || "default") as PermissionMode,
    defaultAdditionalDirs: listSep(process.env.CLAUDE_ADD_DIRS),
    defaultMaxTurns: num(process.env.CLAUDE_MAX_TURNS, undefined) ?? null,
    bridgeToken: process.env.BRIDGE_TOKEN?.trim() || null,
    logLevel: (process.env.LOG_LEVEL as ServerConfig["logLevel"]) || "info",
    clientDistDir: clientDist,
  };
}
