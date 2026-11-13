// The live screen's transport counters for the link agent on this server (apps/link-service/agent.mjs), which adds
// them to the link service's ops stats:
//   GET /api/computer/screen-transport  ScreenTransportCounters; owner-trust loopback only (the agent's own way in, as
//                                       POST /api/computer/egress/agent), never a session, a tunnelled request, a
//                                       companion or a shared server's bot shell
// Aggregate numbers only, copied field by field, so nothing about a person, a bot or an address can ride along if the
// stats grow. The admin's fuller view stays at GET /api/desktop-viewer/transport.
import type { RequestAuth } from "../request-auth.ts";
import type { ScreenTransportStats } from "../screen-direct.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const SCREEN_TRANSPORT_AGENT_PATH = "/api/computer/screen-transport";

type Tally = Record<string, number>;

export interface ScreenTransportCounters {
  v: 1;
  /** when this server started counting (its boot), ISO 8601; null if unknown */
  since: string | null;
  /** whether this server can answer direct offers at all */
  available: boolean;
  /** screens by path: "direct", "cloudflare-turn", "our-relay" */
  paths: Tally;
  /** winning candidate pairs, "<server's type>/<app's type>" */
  pairs: Tally;
  direct: { sessions: number; open: number; failed: number; bytesSent: number; bytesReceived: number; candidates: Tally };
  relay: { sessions: number; open: number; bytesSent: number; bytesReceived: number; reasons: Tally };
}

const KEY = /^[a-z][a-z0-9-]{0,31}(?:\/[a-z][a-z0-9-]{0,31})?$/;
const MAX_KEYS = 64;

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

function tally(value: unknown): Tally {
  const out: Tally = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, n] of Object.entries(value).slice(0, MAX_KEYS)) if (KEY.test(key)) out[key] = count(n);
  return out;
}

function since(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

export function screenTransportCounters(stats: Partial<ScreenTransportStats> | null | undefined): ScreenTransportCounters {
  const direct = (stats?.direct ?? {}) as Partial<ScreenTransportStats["direct"]>;
  const relay = (stats?.relay ?? {}) as Partial<ScreenTransportStats["relay"]>;
  return {
    v: 1,
    since: since(stats?.since),
    available: stats?.available === true,
    paths: tally(stats?.paths),
    pairs: tally(stats?.pairs),
    direct: {
      sessions: count(direct.sessions), open: count(direct.open), failed: count(direct.failed),
      bytesSent: count(direct.bytesSent), bytesReceived: count(direct.bytesReceived), candidates: tally(direct.candidates),
    },
    relay: {
      sessions: count(relay.sessions), open: count(relay.open),
      bytesSent: count(relay.bytesSent), bytesReceived: count(relay.bytesReceived), reasons: tally(relay.reasons),
    },
  };
}

const agentCaller = (auth: RequestAuth) => auth.kind === "loopback" && auth.trust !== "service" && !auth.companionDevice;

export function createScreenTransportAgentRoutes(deps: { stats(): Partial<ScreenTransportStats> | null }): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (path !== SCREEN_TRANSPORT_AGENT_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    if (!agentCaller(auth)) return json(res, 403, { error: "only the link agent on this server reads these" });
    return json(res, 200, screenTransportCounters(deps.stats()));
  };
}
