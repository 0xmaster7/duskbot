// `npm start`: the link service on process.env.PORT. config (all optional):
//   LINK_BASE         public address people's servers reach, default https://link.dusk.bot
//   LINK_DATA_DIR     where state.json lives, default ./data
//   LINK_PACKAGES_DIR the private server builds install.sh downloads, default $LINK_DATA_DIR/packages
//   LINK_TRUST_PROXY  "0" when nothing sits in front of it (then forwarded headers are ignored), default "1"
import "./legacy.mjs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { createLinkService } from "./app.mjs";

export const DEFAULT_BASE = "https://link.dusk.bot";
const root = fileURLToPath(new URL("..", import.meta.url));
const base = (process.env.LINK_BASE || DEFAULT_BASE).replace(/\/+$/, "");
if (!/^https?:\/\/[^/\s]+$/.test(base)) throw new Error("LINK_BASE must be an origin like https://link.example.com");
const port = Number(process.env.PORT || 8790);

const dataDir = process.env.LINK_DATA_DIR || `${root}data`;
const service = createLinkService({
  base,
  dataDir,
  packagesDir: process.env.LINK_PACKAGES_DIR || `${dataDir}/packages`,
  scriptPath: `${root}install.sh`,
  agentPath: `${root}agent.mjs`,
  trustProxy: process.env.LINK_TRUST_PROXY !== "0",
  log: (line) => console.error(line),
});
const server = createServer({ requestTimeout: 0, headersTimeout: 30_000 }, (req, res) => void service.handler(req, res));
server.keepAliveTimeout = 65_000;
const sweep = setInterval(() => service.store.sweep(), 60_000);
sweep.unref();
server.listen(port, process.env.HOST || "0.0.0.0", () => console.log(`link service on :${port}, public base ${base}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { service.close(); server.close(); process.exit(0); });
