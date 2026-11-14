// "Route traffic through this computer" (server/computer-egress.ts):
//   GET  /api/computer/egress        the setting and the route new connections take now (EgressStatus)
//   PUT  /api/computer/egress        {enabled} and/or {blockedSitesEnabled}: owner or admin only
//   POST /api/computer/egress/agent  the link agent's report on this server; owner-trust loopback only, never a session,
//                                    a tunnelled request or a shared server's bot shell
import type { RequestAuth } from "../request-auth.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { parseEgressReport, type ComputerEgress } from "../computer-egress.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ComputerEgressRouteDeps {
  egress: ComputerEgress;
  /** saves the setting and makes it the one in effect */
  setEnabled(enabled: boolean): void;
  /** saves "when a site blocks the cloud" and makes it the one in effect */
  setBlockedSites?(enabled: boolean): void;
}

const agentCaller = (auth: RequestAuth) => auth.kind === "loopback" && auth.trust !== "service" && !auth.companionDevice;

export function createComputerEgressRoutes(deps: ComputerEgressRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/computer/egress/agent" && method === "POST") {
      if (!agentCaller(auth)) return json(res, 403, { error: "only the link agent on this server reports here" });
      const report = parseEgressReport(await readBody(req, 4096));
      if (!report) return json(res, 400, { error: "a report needs online and the proxy's address" });
      return json(res, 200, deps.egress.report(report));
    }
    if (path !== "/api/computer/egress") return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "only the owner can change how the bot computers reach the internet" });
    res.setHeader("cache-control", "no-store");
    if (method === "GET") return json(res, 200, deps.egress.status());
    if (method === "PUT") {
      const body = await readBody(req, 1024) as Record<string, unknown> | null;
      const sites = body?.blockedSitesEnabled;
      if (body?.enabled !== undefined && typeof body.enabled !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
      if (sites !== undefined && (typeof sites !== "boolean" || !deps.setBlockedSites)) return json(res, 400, { error: "blockedSitesEnabled must be true or false" });
      if (typeof body?.enabled !== "boolean" && typeof sites !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
      if (typeof body?.enabled === "boolean") deps.setEnabled(body.enabled);
      if (typeof sites === "boolean") deps.setBlockedSites!(sites);
      await deps.egress.changed();
      return json(res, 200, deps.egress.status());
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
