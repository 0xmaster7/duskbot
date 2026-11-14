// "Route traffic through this computer": the bot computers on this linked VPS send their browsers' web traffic out
// through the person's own computer while it is online, and through this server's network while it is not.
//
// The link agent (apps/link-service/agent.mjs createEgressProxy) serves the proxy on the bot computers' bridge and says
// every few seconds whether the person's computer takes streams. This side turns the setting and that report into a
// Chromium managed policy inside each running bot computer: a PAC script that tries the proxy and falls back to a
// direct connection, written only while the route is up and the box can reach the proxy, removed otherwise. Chromium
// rereads the policy folder on its own, so a change applies to new connections without restarting the browser.
import { BOT_DESKTOP_LABEL } from "../shared/bot-desktop.ts";
import type { EgressStatus } from "../shared/computer-egress.ts";

export type { EgressStatus };

export const EGRESS_POLICY_PATH = "/etc/chromium/policies/managed/omb-egress.json";
/** an agent that has not reported for this long is gone (an old agent, or this server is not a linked VPS) */
const AGENT_STALE_MS = 20_000;
/** after a request fell back while the route is up, Chromium skips the proxy for minutes; a fresh policy undoes that */
const FALLBACK_RETRY_MS = 20_000;
export const EGRESS_PORTS = [80, 443] as const;
/**
 * The app's dial time (median of recent streams) decides the route: through the person's computer only while that
 * path is fast, else this server's own network. Over the relay a dial took 350-1100 ms and a page 10-30x longer than
 * direct (VPS, 2026-11-08), which left Chromium's page area black for minutes. Two limits so it does not flap.
 */
export const FAST_DIAL_MS = 200;
export const SLOW_DIAL_MS = 350;
/** sites that refuse or rate-limit datacenter addresses (Instagram answers 429): through the person's computer even when that path is slow */
export const HOME_ONLY_SITES = ["instagram.com", "facebook.com", "threads.net", "x.com", "twitter.com", "linkedin.com", "tiktok.com", "reddit.com"] as const;
/**
 * those sites' own css, script and image servers: public files that answer this server's address (checked 2026-11-09),
 * so they always load direct. through the person's computer a page's css and scripts share a few long-lived connections,
 * and a path that dropped mid-load took them all and left the page as unstyled html (instagram.com/zuck, 2026-11-09)
 */
export const DIRECT_ASSET_SITES = ["cdninstagram.com", "fbcdn.net", "twimg.com", "licdn.com", "tiktokcdn.com", "tiktokcdn-us.com", "ttwstatic.com",
  "redditstatic.com", "redditmedia.com", "redd.it"] as const;

export interface EgressAgentReport {
  online: boolean;
  proxy: { host: string; port: number } | null;
  /** median dial time in ms, null with no recent dial; absent from an agent that does not measure it */
  dialMs?: number | null;
  active: number;
  relayed: number;
  refused: number;
  fallbacks: number;
}

export type EgressRoute = EgressStatus["route"];

type Docker = (args: string[], timeoutMs?: number) => Promise<{ stdout: string }>;

export function parseEgressReport(value: unknown): EgressAgentReport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const count = (key: string) => (Number.isSafeInteger(raw[key]) && (raw[key] as number) >= 0 ? raw[key] as number : 0);
  const proxy = raw.proxy as Record<string, unknown> | null | undefined;
  const proxyOk = proxy && typeof proxy === "object" && typeof proxy.host === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(proxy.host) &&
    Number.isInteger(proxy.port) && (proxy.port as number) > 0 && (proxy.port as number) < 65536;
  if (typeof raw.online !== "boolean") return null;
  const dialMs = raw.dialMs === null ? null : Number.isFinite(raw.dialMs) && (raw.dialMs as number) >= 0 ? raw.dialMs as number : undefined;
  return {
    online: raw.online, proxy: proxyOk ? { host: proxy.host as string, port: proxy.port as number } : null, ...(dialMs === undefined ? {} : { dialMs }),
    active: count("active"), relayed: count("relayed"), refused: count("refused"), fallbacks: count("fallbacks"),
  };
}

/**
 * The PAC script: web ports on public names go through the person's computer, and a stream it cannot take now (busy,
 * slow, gone) opens from this server's network instead, so a page never breaks on the route. The policy is removed
 * (everything direct) while the computer is offline or its path is slow.
 */
export function egressPac(proxy: { host: string; port: number }, generation: number, only: readonly string[] | null = null): string {
  return [
    "function FindProxyForURL(url, host) {",
    `  // ${generation}`,
    "  var h = host.toLowerCase();",
    "  if (isPlainHostName(h) || h === \"localhost\" || /\\.(localhost|local|localdomain|internal|intranet|lan|home|corp|home\\.arpa)$/.test(h) || h.indexOf(\":\") >= 0) return \"DIRECT\";",
    "  if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(h) && (isInNet(h, \"10.0.0.0\", \"255.0.0.0\") || isInNet(h, \"127.0.0.0\", \"255.0.0.0\") || isInNet(h, \"172.16.0.0\", \"255.240.0.0\") ||",
    "    isInNet(h, \"192.168.0.0\", \"255.255.0.0\") || isInNet(h, \"169.254.0.0\", \"255.255.0.0\") || isInNet(h, \"100.64.0.0\", \"255.192.0.0\"))) return \"DIRECT\";",
    "  var m = /^([a-z][a-z0-9+.-]*):\\/\\/(?:[^\\/@]*@)?(?:\\[[^\\]]*\\]|[^\\/:]*)(?::(\\d+))?/i.exec(url);",
    "  var scheme = m ? m[1].toLowerCase() : \"\";",
    "  var port = m && m[2] ? +m[2] : scheme === \"https\" || scheme === \"wss\" ? 443 : scheme === \"http\" || scheme === \"ws\" ? 80 : 0;",
    `  if (${EGRESS_PORTS.map((one) => `port !== ${one}`).join(" && ")}) return "DIRECT";`,
    `  if (${JSON.stringify(DIRECT_ASSET_SITES)}.some(function (s) { return h === s || dnsDomainIs(h, "." + s); })) return "DIRECT";`,
    ...(only ? [`  if (!${JSON.stringify(only)}.some(function (s) { return h === s || dnsDomainIs(h, "." + s); })) return "DIRECT";`] : []),
    `  return "SOCKS5 ${proxy.host}:${proxy.port}; DIRECT";`,
    "}",
  ].join("\n");
}

/** The managed policy: the PAC above, and WebRTC kept off UDP that would bypass it and show this server's address. */
export function egressPolicy(proxy: { host: string; port: number }, generation: number, only: readonly string[] | null = null): string {
  return JSON.stringify({
    ProxySettings: { ProxyMode: "pac_script", ProxyPacUrl: `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(egressPac(proxy, generation, only)).toString("base64")}` },
    WebRtcIPHandlingPolicy: "disable_non_proxied_udp",
  });
}

/** Runs as root in the box: writes the policy only when the proxy answers from inside it, else removes it. */
const APPLY_SCRIPT = [
  "import os, socket, sys",
  `path = ${JSON.stringify(EGRESS_POLICY_PATH)}`,
  "want = sys.argv[1] == 'on'",
  "if want:",
  "    try: socket.create_connection((sys.argv[2], int(sys.argv[3])), 1.5).close()",
  "    except OSError: want = False",
  "if want:",
  "    tmp = path + '.tmp'",
  "    with open(tmp, 'w') as out: out.write(sys.argv[4])",
  "    os.chmod(tmp, 0o644)",
  "    os.replace(tmp, path)",
  "elif os.path.exists(path):",
  "    os.remove(path)",
  "print('on' if want else 'off')",
].join("\n");

export function egressApplyArgs(container: string, policy: { proxy: { host: string; port: number }; body: string } | null): string[] {
  return ["exec", "-u", "0", container, "python3", "-c", APPLY_SCRIPT, policy ? "on" : "off", policy?.proxy.host ?? "", String(policy?.proxy.port ?? 0), policy?.body ?? ""];
}

export function egressPrompt(enabled: boolean): string {
  return enabled
    ? "Web traffic from your cloud computer's browser leaves through the person's own internet connection while their computer is online and that path is fast, so sites see their home address; otherwise it uses the server's own network, switching by itself. Sites that block servers (Instagram, Facebook, Threads, X, LinkedIn, TikTok, Reddit) always go through the person's connection while their computer is online, even when that path is slow; their image and script servers always use the server's network. To tell the person which address sites see right now, check it in the browser. Only web ports go that way; other connections always use the server's network."
    : "";
}

/** A site that blocked a bot computer's browser keeps going through the person's connection for this long. */
export const BLOCKED_SITE_MS = 12 * 60 * 60_000;
const BLOCKED_SITES_MAX = 50;

/** The site a block was met on, as the PAC matches it: the host without "www.", or null for what never goes that way. */
export function blockedSiteName(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/u, "").replace(/^www\./u, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/u.test(host) || /^\d+(\.\d+){3}$/u.test(host)) return null;
  if (/\.(localhost|local|localdomain|internal|intranet|lan|home|corp|arpa)$/u.test(host)) return null;
  return host;
}

export interface ComputerEgressDeps {
  enabled(): boolean;
  /** "When a site blocks the cloud": only the sites that blocked a bot computer go through the person's connection. */
  blockedSitesEnabled?(): boolean;
  /** Docker on this server's own daemon, or null when the bot computers run somewhere else. */
  docker(): Docker | null;
  now?(): number;
  log?(line: string): void;
}

export function createComputerEgress(deps: ComputerEgressDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  let report: EgressAgentReport | null = null, reportedAt = -Infinity;
  let generation = 0, routeUp = false, lastFallbacks = 0, retryAt = 0, fast = false;
  let running: Promise<void> | null = null, again = false;
  // what each running box holds. a box not in here (just started, or from before this server) gets the current policy,
  // off included: its writable root keeps whatever an earlier route or server left in it across restarts
  const applied = new Map<string, string>();
  // sites that blocked a bot computer's browser on this server's network, and until when they go the person's way
  const blocked = new Map<string, number>();
  const blockedOn = () => deps.blockedSitesEnabled?.() !== false;
  const agentUp = () => Boolean(report?.online && report.proxy) && now() - reportedAt < AGENT_STALE_MS;

  /** Puts a site on the sticky list (the built-in browser's gate reads it through routesHome); false when the setting is off. */
  function markBlocked(raw: string): boolean {
    const site = blockedSiteName(raw);
    if (!site || !blockedOn()) return false;
    blocked.delete(site);
    blocked.set(site, now() + BLOCKED_SITE_MS);
    while (blocked.size > BLOCKED_SITES_MAX) blocked.delete(blocked.keys().next().value!);
    return true;
  }

  function blockedSites(): string[] {
    for (const [site, until] of blocked) if (now() >= until) blocked.delete(site);
    return blockedOn() ? [...blocked.keys()].sort() : [];
  }

  function route(): EgressRoute {
    if (!deps.enabled()) return "off";
    return report?.online && report.proxy && fast && now() - reportedAt < AGENT_STALE_MS ? "computer" : "server";
  }

  async function pass(): Promise<void> {
    const docker = deps.docker();
    const up = route() === "computer";
    // online but slow, or the whole route off: only the sites that block this server's address go through the person's computer
    const sites = [...new Set([...(deps.enabled() ? HOME_ONLY_SITES : []), ...blockedSites()])];
    const sitesOnly = !up && agentUp() && sites.length > 0;
    if (up && !routeUp) generation += 1;
    if (up && report && report.fallbacks > lastFallbacks && now() >= retryAt) { generation += 1; retryAt = now() + FALLBACK_RETRY_MS; }
    lastFallbacks = report?.fallbacks ?? 0;
    routeUp = up;
    if (!docker) return;
    const proxy = report?.proxy;
    const want = (up || sitesOnly) && proxy ? { proxy, body: egressPolicy(proxy, generation, up ? null : sites) } : null;
    const key = want ? `${up ? "on" : `sites=${sites.join(",")}`}:${generation}:${want.proxy.host}:${want.proxy.port}` : "off";
    let ids: string[];
    try {
      const listed = await docker(["ps", "--filter", `label=${BOT_DESKTOP_LABEL}`, "--format", "{{.ID}}"], 15_000);
      ids = listed.stdout.split("\n").map((line) => line.trim()).filter((line) => /^[0-9a-f]{12,64}$/.test(line));
    } catch (error) {
      log(`route traffic: could not list bot computers (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    for (const id of applied.keys()) if (!ids.includes(id)) applied.delete(id);
    await Promise.all(ids.filter((id) => applied.get(id) !== key).map(async (id) => {
      try {
        const out = await docker(egressApplyArgs(id, want), 20_000);
        applied.set(id, key);
        if (want && out.stdout.trim() !== "on") log(`route traffic: bot computer ${id.slice(0, 12)} cannot reach the proxy; it uses the server's network`);
      } catch (error) {
        // a read-only (strict) box cannot hold the policy; its own firewall keeps it off the proxy anyway
        applied.set(id, key);
        log(`route traffic: could not update bot computer ${id.slice(0, 12)} (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
      }
    }));
  }

  function reconcile(): Promise<void> {
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await pass(); } while (again); }
      finally { running = null; }
    })();
    return running;
  }

  return {
    /** the agent's report; answers what the agent should do */
    report(value: EgressAgentReport): { enabled: boolean } {
      report = value;
      reportedAt = now();
      if (value.dialMs === undefined) fast = true;
      else if (value.dialMs !== null) fast = value.dialMs <= (fast ? SLOW_DIAL_MS : FAST_DIAL_MS);
      void reconcile();
      // the agent refuses every stream while this is false, so it is on for either setting; the PAC picks the sites
      return { enabled: deps.enabled() || blockedOn() };
    },
    /** after the setting changed */
    changed(): Promise<void> {
      return reconcile();
    },
    /**
     * A bot computer's browser was blocked on `site` from this server's network: from now on, for this session, that
     * site (and its subdomains) goes through the person's own connection while their computer is online. True once the
     * bot computers hold that route; false when it cannot happen now (setting off, computer offline, no link agent),
     * so the caller moves on. Offline later, the policy goes and the site is back on this network by itself.
     */
    async routeSite(raw: string): Promise<boolean> {
      if (!agentUp() || !deps.docker()) return false;
      // everything already leaves through the person's computer: that route cannot help this site
      if (route() === "computer" || !markBlocked(raw)) return false;
      generation += 1;
      await reconcile();
      return agentUp();
    },
    markBlocked,
    /** Whether a connection to `host` goes the person's way: it or a parent domain is on the list. */
    routesHome(host: string): boolean {
      const name = host.toLowerCase().replace(/\.$/u, "");
      return blockedSites().some((site) => name === site || name.endsWith(`.${site}`));
    },
    status(): EgressStatus {
      const fresh = report !== null && now() - reportedAt < AGENT_STALE_MS;
      return {
        available: fresh,
        enabled: deps.enabled(),
        route: route(),
        activeStreams: fresh ? report!.active : 0,
        relayedStreams: fresh ? report!.relayed : 0,
        refusedStreams: fresh ? report!.refused : 0,
        blockedSitesEnabled: blockedOn(),
        blockedSites: blockedSites(),
      };
    },
    prompt(): string {
      return egressPrompt(deps.enabled() && report !== null && now() - reportedAt < AGENT_STALE_MS);
    },
  };
}

export type ComputerEgress = ReturnType<typeof createComputerEgress>;
