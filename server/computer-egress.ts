// "Route traffic through this computer": the bot computers on this linked VPS send their browsers' web traffic out
// through the person's own computer while it is online, and through this server's network while it is not.
//
// The link agent (link-service/agent.mjs createEgressProxy) serves the proxy on the bot computers' bridge and says
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

export interface EgressAgentReport {
  online: boolean;
  proxy: { host: string; port: number } | null;
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
  return {
    online: raw.online, proxy: proxyOk ? { host: proxy.host as string, port: proxy.port as number } : null,
    active: count("active"), relayed: count("relayed"), refused: count("refused"), fallbacks: count("fallbacks"),
  };
}

/**
 * The PAC script: web ports on public names go through the person's computer, with no fallback to this server's
 * network: a refused request fails instead, so a page cannot push the browser off the proxy by exhausting it. The
 * policy is removed (everything direct) only once the agent reports the computer offline.
 */
export function egressPac(proxy: { host: string; port: number }, generation: number): string {
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
    `  return "SOCKS5 ${proxy.host}:${proxy.port}";`,
    "}",
  ].join("\n");
}

/** The managed policy: the PAC above, and WebRTC kept off UDP that would bypass it and show this server's address. */
export function egressPolicy(proxy: { host: string; port: number }, generation: number): string {
  return JSON.stringify({
    ProxySettings: { ProxyMode: "pac_script", ProxyPacUrl: `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(egressPac(proxy, generation)).toString("base64")}` },
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
    ? "While the person's own computer is online, web traffic from your cloud computer's browser leaves through their internet connection, so sites see their home address instead of a data centre. When it is offline the browser uses the server's own network on its own. Only web ports go that way; other connections always use the server's network."
    : "";
}

export interface ComputerEgressDeps {
  enabled(): boolean;
  /** Docker on this server's own daemon, or null when the bot computers run somewhere else. */
  docker(): Docker | null;
  now?(): number;
  log?(line: string): void;
}

export function createComputerEgress(deps: ComputerEgressDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  let report: EgressAgentReport | null = null, reportedAt = -Infinity;
  let generation = 0, routeUp = false, lastFallbacks = 0, retryAt = 0;
  // a box may hold a policy from before this server started; the first pass clears what is not wanted
  let dirty = true, running: Promise<void> | null = null, again = false;
  const applied = new Map<string, string>();

  function route(): EgressRoute {
    if (!deps.enabled()) return "off";
    return report?.online && report.proxy && now() - reportedAt < AGENT_STALE_MS ? "computer" : "server";
  }

  async function pass(): Promise<void> {
    const docker = deps.docker();
    const up = route() === "computer";
    if (up && !routeUp) generation += 1;
    if (!up && routeUp) dirty = true;
    if (up && report && report.fallbacks > lastFallbacks && now() >= retryAt) { generation += 1; retryAt = now() + FALLBACK_RETRY_MS; }
    lastFallbacks = report?.fallbacks ?? 0;
    routeUp = up;
    if (!docker || (!up && !dirty)) return;
    const proxy = report?.proxy;
    const want = up && proxy ? { proxy, body: egressPolicy(proxy, generation) } : null;
    const key = want ? `on:${generation}:${want.proxy.host}:${want.proxy.port}` : "off";
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
    if (!want) dirty = false;
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
      void reconcile();
      return { enabled: deps.enabled() };
    },
    /** after the setting changed */
    changed(): Promise<void> {
      if (!deps.enabled()) dirty = true;
      return reconcile();
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
      };
    },
    prompt(): string {
      return egressPrompt(deps.enabled() && report !== null && now() - reportedAt < AGENT_STALE_MS);
    },
  };
}

export type ComputerEgress = ReturnType<typeof createComputerEgress>;
