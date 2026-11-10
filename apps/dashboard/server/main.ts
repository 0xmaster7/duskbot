import "../../../electron/legacy-names.mjs";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createErrorReporter, reportProcessErrors } from "../../../electron/error-report.mjs";
import { fileSpool } from "../../../electron/error-report-spool.mjs";
import { createDashboardApp } from "./app.ts";
import { providersFromEnv } from "./auth/providers.ts";
import { mailerFromEnv } from "./auth/mail.ts";

const port = Number(process.env.DUSK_DASHBOARD_PORT ?? 7480);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid dashboard port.");
const host = process.env.DUSK_DASHBOARD_HOST ?? "127.0.0.1";
const publicUrl = process.env.DUSK_DASHBOARD_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const home = process.env.HOME ?? process.env.USERPROFILE;
if (!process.env.DUSK_DASHBOARD_DATA && !home) throw new Error("Set DUSK_DASHBOARD_DATA.");
const dataDir = process.env.DUSK_DASHBOARD_DATA ?? `${home}/.duskbot-dashboard`;
const defaultStatic = decodeURIComponent(new URL("../dist", import.meta.url).pathname);
const staticDir = process.env.DUSK_DASHBOARD_STATIC ?? (existsSync(defaultStatic) ? defaultStatic : null);
const publicAddress = new URL(publicUrl);
const dev = process.env.DUSK_DASHBOARD_DEV === "1" || (publicAddress.protocol === "http:" && ["127.0.0.1", "localhost"].includes(publicAddress.hostname));
const version = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
const environment = process.env.DUSK_ENVIRONMENT ?? (dev ? "development" : "production");
const service = createErrorReporter({ dsn: process.env.DUSK_ERROR_DSN, component: "dashboard", release: version, environment, spool: fileSpool(`${dataDir}/error-spool`) });
reportProcessErrors(service).flush();
const page = createErrorReporter({ dsn: process.env.DUSK_ERROR_DSN, component: "dashboard-web", release: version, environment });
const app = createDashboardApp({ errors: { service, page }, version, dataDir, publicUrl, mailer: mailerFromEnv(process.env, { dev }), oauth: providersFromEnv(process.env), dev,
  signupOpen: process.env.DUSK_AUTH_SIGNUP_OPEN !== "0", trustProxy: process.env.DUSK_TRUST_PROXY === "1", staticDir: staticDir || null });
const server = createServer(app.handle);
server.listen(port, host, () => console.log(`dashboard service listening on http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  app.close();
  server.close();
  server.closeIdleConnections();
});
