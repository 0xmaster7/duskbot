// the link relays at the top of the admin ops page: every link service node (contabo, oracle mumbai, ...) and the
// cloudflare worker. each answers GET /ops/relay/stats and PUT /ops/relay/limits behind its ops token; this proxies to
// them. link nodes share DUSK_LINK_STATS_TOKEN; the ones past the first come from DUSK_LINK_NODES and from the first
// node's own list of its peers, so a node added there shows up here by itself.
import type { OpsRelayCard, OpsRelayId, OpsRelayStats } from "../../../src/admin/ops-types.ts";
import { linkAccountRef } from "../../link-grant.ts";

export class RelayError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

interface RelayTarget { id: OpsRelayId; label: string; url: string; token: string | null; tokenEnv: string; link: boolean }

const NODE_ID = /^[a-z][a-z0-9-]{1,30}$/;
const linkLabel = (id: string, region?: string | null) => `${id.replace(/-/g, " ")} relay${region ? ` (${region})` : ""}`;
/** DUSK_LINK_NODES: "oracle-in=https://link-in.dusk.bot,..." the link nodes past the first, also found on their own */
export function linkNodes(value: string | undefined): Array<{ id: string; url: string }> {
  return (value ?? "").split(",").map(part => part.trim()).flatMap(part => {
    const match = /^([a-z][a-z0-9-]{1,30})=(https?:\/\/[^/\s]+)$/.exec(part);
    return match && match[1] !== "contabo" && match[1] !== "cloudflare" ? [{ id: match[1], url: match[2]! }] : [];
  });
}

/** env names: DUSK_LINK_URL + DUSK_LINK_STATS_TOKEN (contabo, and DUSK_LINK_NODES), DUSK_CF_RELAY_URL + DUSK_CF_RELAY_OPS_TOKEN (cloudflare) */
export function relayTargets(env: NodeJS.ProcessEnv): RelayTarget[] {
  const token = env.DUSK_LINK_STATS_TOKEN || null;
  return [
    { id: "contabo", label: "contabo relay", url: env.DUSK_LINK_URL || "https://link.dusk.bot", token, tokenEnv: "DUSK_LINK_STATS_TOKEN", link: true },
    ...linkNodes(env.DUSK_LINK_NODES).map(node => ({ id: node.id, label: linkLabel(node.id), url: node.url, token, tokenEnv: "DUSK_LINK_STATS_TOKEN", link: true })),
    { id: "cloudflare", label: "cloudflare relay", url: env.DUSK_CF_RELAY_URL || "https://relay.dusk.bot", token: env.DUSK_CF_RELAY_OPS_TOKEN || null, tokenEnv: "DUSK_CF_RELAY_OPS_TOKEN", link: false },
  ];
}

const TIMEOUT_MS = 6000;
const LIMIT_KEY = /^[A-Za-z][A-Za-z0-9]{0,47}$/;

/** a limits change from the page: a few known-looking keys, each a whole number, null (off) or a boolean */
export function cleanLimits(body: Record<string, unknown>): Record<string, number | boolean | null> {
  const keys = Object.keys(body);
  if (!keys.length || keys.length > 16) throw new RelayError(400, "invalid_request", "Send at least one limit.");
  const out: Record<string, number | boolean | null> = {};
  for (const key of keys) {
    const value = body[key];
    if (!LIMIT_KEY.test(key)) throw new RelayError(400, "invalid_request", "Unknown limit.");
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) out[key] = value;
    else throw new RelayError(400, "invalid_request", `${key} must be a whole number, off or on.`);
  }
  return out;
}

const MBIT = 1_000_000 / 8, GB = 1e9;
/** made-up relays for the local fixture (sample data), with limits that change when edited */
function fixtureStats(now: number, accounts: ReadonlyArray<{ id: string }>, limits: Record<OpsRelayId, OpsRelayStats["limits"]>): Record<OpsRelayId, OpsRelayStats> {
  const day = new Date(now).getUTCDate(), people = accounts.slice(0, 5).map(account => linkAccountRef(account.id));
  const top = (scale: number) => people.map((account, i) => ({ account, tunnels: 1 + (i % 2), bytesToday: Math.round(scale / (i + 1) ** 1.4) }));
  return {
    contabo: { relay: "contabo", now: { tunnels: 38, accounts: 31, bytesPerSecOut: 41 * MBIT, bytesPerSecIn: 6 * MBIT, cpu: 23, rssMb: 412 }, today: { bytesOut: 182 * GB, bytesIn: 21 * GB },
      month: { bytesOut: 2_310 * GB, bytesIn: 240 * GB, projectedBytesOut: Math.round(2_310 * GB / day * 30), allowanceBytes: 32_000 * GB }, limits: limits.contabo, top: top(24 * GB), busy: !!limits.contabo.paused },
    cloudflare: { relay: "cloudflare", now: { tunnels: 12, accounts: 11, bytesPerSecOut: 9 * MBIT, bytesPerSecIn: 1.5 * MBIT, cpu: null, rssMb: null }, today: { bytesOut: 34 * GB, bytesIn: 4 * GB },
      month: { bytesOut: 420 * GB, bytesIn: 51 * GB, projectedBytesOut: Math.round(420 * GB / day * 30), allowanceBytes: null }, limits: limits.cloudflare, top: top(9 * GB), busy: !!limits.cloudflare.paused,
      cost: { estimated: true, monthCents: 1_840, projectedCents: Math.round(1_840 / day * 30), awakeHours: 3_270, messages: 4_100_000 } },
  };
}

export function createRelays(options: { env: NodeJS.ProcessEnv; fetch?: typeof fetch; now: () => number; accounts: () => ReadonlyArray<{ id: string; email: string }>; fixture?: boolean }) {
  const fetcher = options.fetch ?? fetch;
  const targets = relayTargets(options.env);
  const sample: Record<OpsRelayId, OpsRelayStats["limits"]> = {
    contabo: { perTunnelBytesPerSec: 25 * MBIT, burstBytes: 32 * 1024 * 1024, perTunnelDailyBytes: 150 * 1024 ** 3, tunnelsPerAccount: 5, globalCeilingBytesPerSec: 800 * MBIT, maxTunnels: 400, paused: false },
    cloudflare: { perTunnelBytesPerSec: 25 * MBIT, burstBytes: null, perTunnelDailyBytes: null, tunnelsPerAccount: 10, globalCeilingBytesPerSec: null, maxTunnels: 5000,
      accountBytesPerSec: 25 * MBIT, accountFullSpeedBytes: 50 * GB, floorBytesPerSec: 2 * MBIT, paused: false },
  };
  const fixtureCard = (target: RelayTarget, who: ReturnType<typeof people>): OpsRelayCard =>
    ({ id: target.id, label: target.label, url: target.url, at: options.now(), configured: true, ok: true, error: null, stats: shape(fixtureStats(options.now(), options.accounts(), sample)[target.id as "contabo" | "cloudflare"], who) });
  const fixtureTargets = () => targets.filter(target => target.id === "contabo" || target.id === "cloudflare");

  async function call(target: RelayTarget, path: string, init: RequestInit = {}) {
    let res: Response;
    try {
      res = await fetcher(`${target.url.replace(/\/+$/, "")}${path}`, { ...init, headers: { accept: "application/json", authorization: `Bearer ${target.token}`, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new RelayError(502, "relay_unreachable", (error as Error)?.name === "TimeoutError" ? "The relay did not answer in time." : "The relay can't be reached.");
    }
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.status === 404 || res.status === 401 || res.status === 403) throw new RelayError(502, "relay_auth", "The relay refused the ops token, or it has no ops endpoint yet.");
    if (res.status === 400) throw new RelayError(400, "invalid_request", typeof data?.error === "string" ? data.error.slice(0, 200) : "The relay refused those limits.");
    if (!res.ok || !data) throw new RelayError(502, "relay_failed", `The relay answered ${res.status}.`);
    return data;
  }

  /** the relay's acct is a hash of the account id (link grants); map it back, and the plain id too, for names and links */
  function people() {
    const map = new Map<string, { accountId: string; email: string }>();
    for (const account of options.accounts()) {
      const person = { accountId: account.id, email: account.email };
      map.set(linkAccountRef(account.id), person);
      map.set(account.id, person);
    }
    return map;
  }

  function shape(stats: OpsRelayStats, who: ReturnType<typeof people>): OpsRelayStats {
    const fairUse = stats.fairUse && Array.isArray(stats.fairUse.accounts) ? { month: stats.fairUse.month, accounts: stats.fairUse.accounts.slice(0, 20).map(row => {
      const known = row.account ? who.get(row.account) : undefined;
      return { ...row, accountId: known?.accountId ?? null, email: known?.email ?? null };
    }) } : undefined;
    return { ...stats, top: (Array.isArray(stats.top) ? stats.top : []).slice(0, 10).map(row => {
      const known = who.get(row.account);
      return { ...row, accountId: known?.accountId ?? null, email: known?.email ?? null };
    }), ...(fairUse ? { fairUse } : {}) };
  }

  async function one(target: RelayTarget, who: ReturnType<typeof people>): Promise<OpsRelayCard> {
    const base = { id: target.id, label: target.label, url: target.url, at: options.now() };
    if (!target.token) return { ...base, configured: false, ok: false, error: `set ${target.tokenEnv} to show this relay.`, stats: null };
    try {
      const stats = await call(target, "/ops/relay/stats") as unknown as OpsRelayStats;
      return { ...base, configured: true, ok: true, error: null, stats: shape(stats, who) };
    } catch (error) {
      return { ...base, configured: true, ok: false, error: error instanceof RelayError ? error.message : "The relay can't be read.", stats: null };
    }
  }

  return {
    async list(): Promise<{ relays: OpsRelayCard[]; at: number }> {
      const who = people();
      if (options.fixture) return { relays: fixtureTargets().map(target => fixtureCard(target, who)), at: options.now() };
      const cards = await Promise.all(targets.map(target => one(target, who)));
      // nodes the link nodes know of that are not listed yet: added for good, asked now
      const fresh: RelayTarget[] = [];
      for (const card of cards) for (const node of card.stats?.nodes ?? []) {
        if (typeof node?.id !== "string" || !NODE_ID.test(node.id) || typeof node.url !== "string" || !/^https?:\/\/[^/\s]+$/.test(node.url)) continue;
        if (targets.some(target => target.id === node.id) || fresh.some(target => target.id === node.id)) continue;
        if (node.id === "cloudflare" || targets.some(target => target.url === node.url)) continue;
        fresh.push({ id: node.id, label: linkLabel(node.id, node.region), url: node.url, token: targets[0]!.token, tokenEnv: "DUSK_LINK_STATS_TOKEN", link: true });
      }
      if (fresh.length) {
        targets.splice(targets.length - 1, 0, ...fresh);
        const more = await Promise.all(fresh.map(target => one(target, who)));
        cards.splice(cards.length - 1, 0, ...more);
      }
      // a region, once a node said it
      for (const card of cards) { const target = targets.find(item => item.id === card.id); if (target?.link && card.id !== "contabo" && card.stats?.node?.region) card.label = target.label = linkLabel(card.id, card.stats.node.region); }
      return { relays: cards, at: options.now() };
    },
    async setLimits(id: string, body: Record<string, unknown>): Promise<OpsRelayCard> {
      if (!targets.some(item => item.id === id) && NODE_ID.test(id)) await this.list();
      const target = targets.find(item => item.id === id);
      if (!target) throw new RelayError(404, "not_found", "Not found.");
      if (options.fixture) { const key = target.id as "contabo" | "cloudflare"; sample[key] = { ...sample[key], ...cleanLimits(body) }; return fixtureCard(target, people()); }
      if (!target.token) throw new RelayError(409, "not_configured", `Set ${target.tokenEnv} first.`);
      const limits = cleanLimits(body);
      await call(target, "/ops/relay/limits", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(limits) });
      return one(target, people());
    },
  };
}
