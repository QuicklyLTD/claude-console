import fs from "node:fs";
import path from "node:path";
import { pino, multistream, stdTimeFunctions, type Logger } from "pino";
import { DATA_DIR, LOG_DIR, loadConfig } from "./config.js";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const config = loadConfig();
const logFile = path.join(LOG_DIR, "server.log");
const errorFile = path.join(LOG_DIR, "error.log");

/**
 * Dual-sink logger:
 *   - stdout (JSON; pipe to `| pino-pretty` if you want colors)
 *   - append-only server.log (all levels)
 *   - append-only error.log (errors only)
 */
export const logger: Logger = pino(
  {
    level: config.logLevel,
    base: { app: "claude-console" },
    timestamp: stdTimeFunctions.isoTime,
  },
  multistream([
    { level: config.logLevel, stream: process.stdout },
    { level: config.logLevel, stream: fs.createWriteStream(logFile, { flags: "a" }) },
    { level: "error", stream: fs.createWriteStream(errorFile, { flags: "a" }) },
  ]),
);

export function errorLog(scope: string) {
  return logger.child({ scope });
}
