import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  listSessions as sdkListSessions,
  getSessionMessages as sdkGetSessionMessages,
  deleteSession as sdkDeleteSession,
  renameSession as sdkRenameSession,
} from "@anthropic-ai/claude-agent-sdk";
import {
  createUiSession,
  deleteUiSession,
  getUiSession,
  listUiSessions,
  patchUiSession,
} from "./db.js";
import { loadConfig } from "./config.js";
import { errorLog } from "./logger.js";
import { validateAbsolutePath, validateDirList } from "./path-safety.js";
import { dropReplayForSession } from "./ws-handler.js";
import type {
  ConfigDTO,
  SessionDetail,
  UISessionRow,
} from "@shared/protocol.js";

const log = errorLog("http");

export function createRoutes(): Router {
  const r = Router();
  const cfg = loadConfig();

  r.get("/config", (_req, res) => {
    const dto: ConfigDTO = {
      defaults: {
        cwd: cfg.defaultCwd,
        model: cfg.defaultModel,
        permissionMode: cfg.defaultPermissionMode,
        additionalDirectories: cfg.defaultAdditionalDirs,
        maxTurns: cfg.defaultMaxTurns,
      },
      authRequired: !!cfg.bridgeToken,
      version: "0.1.0",
    };
    res.json(dto);
  });

  r.get("/sessions", (_req, res) => {
    const sessions: UISessionRow[] = listUiSessions();
    res.json({ sessions });
  });

  const CreateBody = z
    .object({
      title: z.string().trim().max(200).optional(),
      workingDir: z.string().trim().max(1000).nullable().optional(),
      additionalDirectories: z.array(z.string()).optional(),
      model: z.string().trim().max(100).nullable().optional(),
      permissionMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).optional(),
      systemPromptAppend: z.string().max(20_000).nullable().optional(),
      maxTurns: z.number().int().positive().nullable().optional(),
      tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
      color: z.string().max(40).nullable().optional(),
    })
    .strict();

  r.post("/sessions", (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);
    const defaults = loadConfig();

    const workingDir = parsed.data.workingDir ?? defaults.defaultCwd;
    if (workingDir) {
      const pv = validateAbsolutePath(workingDir);
      if (!pv.ok) return bad(res, [{ message: `workingDir: ${pv.reason}` }]);
    }
    const addDirsIn = parsed.data.additionalDirectories ?? defaults.defaultAdditionalDirs;
    const dv = validateDirList(addDirsIn);
    if (!dv.ok) return bad(res, [{ message: `additionalDirectories: ${dv.reason}` }]);

    const input = {
      ...parsed.data,
      workingDir,
      model: parsed.data.model ?? defaults.defaultModel,
      permissionMode: parsed.data.permissionMode ?? defaults.defaultPermissionMode,
      additionalDirectories: dv.resolved,
      maxTurns: parsed.data.maxTurns ?? defaults.defaultMaxTurns ?? null,
    };
    const session = createUiSession(input);
    res.status(201).json({ session });
  });

  const PatchBody = CreateBody.partial();

  r.get("/sessions/:id", async (req, res) => {
    const session = getUiSession(req.params.id);
    if (!session) return notFound(res);
    let sdkMessages: SessionDetail["sdkMessages"] = null;
    if (session.sdkSessionId) {
      try {
        // The SDK's getSessionMessages searches all project directories when
        // `dir` is omitted, so passing it is an optimization, not a requirement.
        // A null workingDir must NOT prevent history from loading.
        const opts = session.workingDir ? { dir: session.workingDir } : undefined;
        sdkMessages = (await sdkGetSessionMessages(session.sdkSessionId, opts)) as SessionDetail["sdkMessages"];
      } catch (err) {
        log.warn({ err: String(err), id: session.sdkSessionId }, "getSessionMessages failed");
      }
    }
    res.json({ session, sdkMessages } satisfies SessionDetail);
  });

  r.patch("/sessions/:id", (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);

    if (parsed.data.workingDir) {
      const pv = validateAbsolutePath(parsed.data.workingDir);
      if (!pv.ok) return bad(res, [{ message: `workingDir: ${pv.reason}` }]);
    }
    if (parsed.data.additionalDirectories) {
      const dv = validateDirList(parsed.data.additionalDirectories);
      if (!dv.ok) return bad(res, [{ message: `additionalDirectories: ${dv.reason}` }]);
    }

    const updated = patchUiSession(req.params.id, parsed.data);
    if (!updated) return notFound(res);
    res.json({ session: updated });
  });

  r.delete("/sessions/:id", async (req, res) => {
    const existing = getUiSession(req.params.id);
    if (!existing) return notFound(res);

    // Remove SDK-side transcript when known so the resume picker matches.
    if (existing.sdkSessionId && existing.workingDir) {
      try { await sdkDeleteSession(existing.sdkSessionId, { dir: existing.workingDir }); }
      catch (err) { log.warn({ err: String(err) }, "sdkDeleteSession failed"); }
    }
    deleteUiSession(req.params.id);
    dropReplayForSession(req.params.id);
    res.json({ ok: true });
  });

  r.post("/sessions/:id/rename-sdk", async (req, res) => {
    const { title } = (req.body ?? {}) as { title?: string };
    if (!title) return bad(res, [{ message: "title required" }]);
    const existing = getUiSession(req.params.id);
    if (!existing?.sdkSessionId || !existing.workingDir) return notFound(res);
    await sdkRenameSession(existing.sdkSessionId, title, { dir: existing.workingDir });
    res.json({ ok: true });
  });

  r.get("/sdk-sessions", async (req, res) => {
    const rawDir = typeof req.query.dir === "string" ? req.query.dir : undefined;
    let validatedDir: string | undefined;
    if (rawDir) {
      const pv = validateAbsolutePath(rawDir);
      if (!pv.ok) return bad(res, [{ message: `dir: ${pv.reason}` }]);
      validatedDir = pv.resolved;
    }
    try {
      const list = await sdkListSessions(validatedDir ? { dir: validatedDir } : undefined);
      res.json({ dir: validatedDir ?? null, sessions: list });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return r;
}

function bad(res: Response, issues: unknown): void {
  res.status(400).json({ error: "Invalid body", issues });
}
function notFound(res: Response): void {
  res.status(404).json({ error: "Not found" });
}

// Unused `Request` import retained if future middlewares need it.
export type { Request };
