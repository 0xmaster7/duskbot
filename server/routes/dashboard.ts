import { DASHBOARD_DISCOVERY_PATH, DEFAULT_DASHBOARD_URL } from "../../shared/dashboard-protocol.ts";
import type { createDashboardReporter } from "../dashboard-reporter.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS } from "./table.ts";
import type { RouteHandler } from "./table.ts";

export interface DashboardRouteDeps {
  reporter: ReturnType<typeof createDashboardReporter>;
  linkAgentBase(): string | null;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}
export function dashboardUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}
export function createDashboardRoutes(deps: DashboardRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/dashboard/link" || !["GET", "POST", "DELETE"].includes(method)) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the owner or an admin can connect the dashboard." });
    if (method === "GET") return json(res, 200, deps.reporter.status());
    if (String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "content-type must be application/json" });
    if (method === "DELETE") { await deps.reporter.forget(); return json(res, 200, { ok: true }); }
    const body = await readBody(req) as { url?: unknown; enrollToken?: unknown } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "Expected a JSON object." });
    if (body.enrollToken !== undefined && (typeof body.enrollToken !== "string" || body.enrollToken.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(body.enrollToken))) return json(res, 400, { error: "Invalid enrollment token." });
    let selected: unknown = body.url ?? (deps.env ?? process.env).OMB_DASHBOARD_URL;
    if (selected === undefined) {
      const base = deps.linkAgentBase();
      if (base) {
        try {
          const response = await (deps.fetch ?? fetch)(`${base.replace(/\/+$/, "")}${DASHBOARD_DISCOVERY_PATH}`, { signal: AbortSignal.timeout(2000), redirect: "error" });
          if (response.ok) {
            const discovery = await response.json() as { v?: number; url?: unknown };
            if (discovery.v === 1) selected = dashboardUrl(discovery.url) ?? undefined;
          }
        } catch {}
      }
      selected ??= DEFAULT_DASHBOARD_URL;
    }
    const url = dashboardUrl(selected);
    if (!url) return json(res, 400, { error: "Use an https dashboard URL, or localhost http for a fixture." });
    try {
      const answer = await (body.enrollToken === undefined ? deps.reporter.link(url) : deps.reporter.link(url, { enrollToken: body.enrollToken as string }));
      return json(res, 200, { claimUrl: answer.claimUrl, dashboardUrl: answer.dashboardUrl, workspaceId: answer.workspaceId, claimed: answer.claimExpiresAt === 0 });
    } catch { return json(res, 502, { error: "Could not connect to the dashboard. Try again shortly." }); }
  };
}
