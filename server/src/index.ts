import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createRoutes } from "./http-routes.js";
import { attachWs } from "./ws-handler.js";
import { requireToken, safeCompare } from "./auth.js";

const config = loadConfig();
const app = express();

// Parse JSON bodies up to 2MB (tool inputs may be large).
app.use(express.json({ limit: "2mb" }));

// Request logging (lightweight).
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url }, "http");
  next();
});

app.use("/api", requireToken, createRoutes());

// Serve client/dist (vite build output). Dev mode: vite runs separately on 5181.
if (fs.existsSync(config.clientDistDir)) {
  // Static assets are fingerprinted by Vite (hash in filename) so they can be
  // cached aggressively. index.html is NOT fingerprinted — it must never be
  // cached or the browser will keep loading stale bundle references.
  app.use(
    express.static(config.clientDistDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        } else if (/\/assets\/.+\.(js|css|woff2?|png|svg|jpg|gif)$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.join(config.clientDistDir, "index.html"));
  });
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  if (config.bridgeToken) {
    const provided = url.searchParams.get("token") ?? "";
    if (!safeCompare(provided, config.bridgeToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

attachWs(wss);

httpServer.listen(config.port, config.host, () => {
  logger.info(
    {
      http: `http://${config.host}:${config.port}`,
      ws: `ws://${config.host}:${config.port}/ws`,
      clientDist: fs.existsSync(config.clientDistDir) ? config.clientDistDir : "(dev mode — run client separately)",
      authRequired: !!config.bridgeToken,
    },
    "claude-console server listening",
  );
});

// Graceful shutdown: drain WS + close HTTP.
const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  wss.clients.forEach((c) => { try { c.close(1001, "server shutting down"); } catch { /* noop */ } });
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
