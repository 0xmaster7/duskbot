// `pnpm dev:app [electron args]`: the Vite UI plus the desktop app, which runs the harness from source as its own
// child (electron/dev-server-child.mjs). DUSK_PORT, DUSK_UI_PORT and DUSK_DATA_DIR work as they do for dev:server and dev.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const uiPort = Number(process.env.DUSK_UI_PORT) || 5199;
const env = { ...process.env, DUSK_DEV_OWN_SERVER: "1", ELECTRON_START_URL: process.env.ELECTRON_START_URL || `http://127.0.0.1:${uiPort}` };
delete env.ELECTRON_RUN_AS_NODE;

const prepared = spawnSync(process.execPath, ["scripts/prepare-cloudflared.mjs", "--current"], { cwd: root, stdio: "inherit" });
if (prepared.status !== 0) process.exit(prepared.status ?? 1);

const children = new Set();
let ending = false;
const end = (code) => {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code ?? 0;
};
const run = (command, args) => {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.add(child);
  child.once("exit", (code) => { children.delete(child); end(code); });
  return child;
};
process.once("SIGINT", () => end(0));
process.once("SIGTERM", () => end(0));

run(process.execPath, [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url))]);
for (let attempt = 0; attempt < 120 && !ending; attempt += 1) {
  if (await fetch(env.ELECTRON_START_URL).then(() => true, () => false)) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ending) run(require("electron"), [".", ...process.argv.slice(2)]);
