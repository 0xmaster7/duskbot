import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// the dashboard service (dashboard/server/main.ts); `pnpm dashboard:fixture` starts one with a fake account server
const service = process.env.OMB_DASHBOARD_SERVICE || "http://127.0.0.1:7480";

// the hosted account dashboard page, sharing the app's mascots through the @ alias
export default defineConfig({
  root: here("."),
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": here("../src") } },
  define: { __APP_VERSION__: JSON.stringify("dashboard") },
  build: { outDir: here("./dist"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.OMB_DASHBOARD_DEV_PORT) || 5288,
    // a worktree may link node_modules from another checkout; its fonts must still be served
    fs: { allow: [here(".."), realpathSync(here("../node_modules"))] },
    proxy: { "/v1": { target: service }, "/.well-known": { target: service } },
  },
  preview: { host: "127.0.0.1", port: Number(process.env.OMB_DASHBOARD_DEV_PORT) || 5288 },
});
