import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.js";

/**
 * Constant-time string comparison. Returns false immediately for mismatched
 * lengths (a side-channel itself but not avoidable without HMAC); otherwise
 * runs the timing-safe byte compare to prevent character-by-character brute
 * forcing via timing oracle.
 */
export function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Require the same BRIDGE_TOKEN that guards the WS upgrade. Accepted sources:
 *   1. `Authorization: Bearer <token>` header (preferred)
 *   2. `X-Bridge-Token: <token>` header
 *   3. `?token=<token>` query string (kept so the browser can share the WS token)
 *
 * If no token is configured on the server, auth is open.
 */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  const expected = loadConfig().bridgeToken;
  if (!expected) return next();

  const auth = req.header("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerToken = req.header("x-bridge-token") ?? "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const provided = bearer || headerToken || queryToken;

  if (provided && safeCompare(provided, expected)) return next();
  res.status(401).json({ error: "unauthorized" });
}
