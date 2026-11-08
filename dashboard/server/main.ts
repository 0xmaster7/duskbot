import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { createDashboardApp } from "./app.ts";

const port = Number(process.env.OMB_DASHBOARD_PORT ?? 7480);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid dashboard port.");
const host = process.env.OMB_DASHBOARD_HOST ?? "127.0.0.1";
const publicUrl = process.env.OMB_DASHBOARD_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const home = process.env.HOME ?? process.env.USERPROFILE;
if (!process.env.OMB_DASHBOARD_DATA && !home) throw new Error("Set OMB_DASHBOARD_DATA.");
const dataDir = process.env.OMB_DASHBOARD_DATA ?? `${home}/.openmausbot-dashboard`;
const defaultStatic = decodeURIComponent(new URL("../dist", import.meta.url).pathname);
const staticDir = process.env.OMB_DASHBOARD_STATIC ?? (existsSync(defaultStatic) ? defaultStatic : null);
const app = createDashboardApp({ dataDir, publicUrl, accountOrigin: process.env.OMB_ACCOUNT_ORIGIN ?? "https://cloud.openmausbot.com", staticDir: staticDir || null });
const server = createServer(app.handle);
server.listen(port, host, () => console.log(`dashboard service listening on http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  app.close();
  server.close();
  server.closeIdleConnections();
});
