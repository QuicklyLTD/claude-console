import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// NOTE: @anthropic-ai/claude-agent-sdk is imported ONLY for its types on the
// client side. Exclude it from the bundle so its Node-only deps (child_process,
// better-sqlite3) never get pulled in.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "..", "shared"),
    },
  },
  optimizeDeps: {
    exclude: ["@anthropic-ai/claude-agent-sdk"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      external: ["@anthropic-ai/claude-agent-sdk"],
    },
  },
  server: {
    port: 5181,
    proxy: {
      "/api": { target: "http://127.0.0.1:5180", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:5180", ws: true, changeOrigin: true },
    },
  },
});
