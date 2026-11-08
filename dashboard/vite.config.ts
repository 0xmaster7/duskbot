import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const harness = `http://127.0.0.1:${process.env.OMB_PORT || 8799}`;

// the account dashboard: its own page, sharing the app's mascot and wire types through the @ alias
export default defineConfig({
  root: here("."),
  publicDir: here("./public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": here("../src") } },
  define: { __APP_VERSION__: JSON.stringify("dashboard") },
  build: { outDir: here("./dist"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.OMB_DASHBOARD_PORT) || 5288,
    // a worktree may link node_modules from another checkout; its fonts must still be served
    fs: { allow: [here(".."), realpathSync(here("../node_modules"))] },
    proxy: { "/api": { target: harness } },
  },
  preview: { host: "127.0.0.1", port: Number(process.env.OMB_DASHBOARD_PORT) || 5288 },
});
