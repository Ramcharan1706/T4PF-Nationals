import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
const apiProxy = {
  "/api": {
    target: backendUrl,
    changeOrigin: true,
  },
  "/ws": {
    target: backendUrl,
    ws: true,
    changeOrigin: true,
  },
};

export default defineConfig({
  base: process.env.BASE_PATH || "/",

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
    dedupe: ["react", "react-dom"],
  },

  root: rootDir,

  build: {
    outDir: path.resolve(rootDir, "dist"),
    emptyOutDir: true,
  },

  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.app"],
    proxy: apiProxy,
  },

  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.app"],
    proxy: apiProxy,
  },
});