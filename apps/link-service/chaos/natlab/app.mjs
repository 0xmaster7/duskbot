// the lab's app, in the client namespace: the desktop's own relay code with the direct ways it sets up for a server
// (ssh with a key the agent installs, webrtc, the server's cloudflare tunnel), chosen by orderedConnect as the app does.
// it reports to the orchestrator over ipc: which way won and when, and the relay's bytes around a small workload.
import { request } from "node:http";
import { fileURLToPath } from "node:url";

import { createTunnelProxy } from "../../../../electron/vps-link-protocol.mjs";
import { newDirectKey, orderedConnect, sshConnector, wssConnector } from "../../../../electron/vps-link-direct.mjs";
import { loadDataChannel, rtcConnector } from "../../../../electron/vps-link-rtc.mjs";

const config = JSON.parse(process.env.NATLAB_APP);
const say = (message) => process.send?.(message);
const log = (line) => say({ log: line });
const proxy = createTunnelProxy({ base: config.base, id: config.id, key: config.key, token: config.token, log, proxy: config.proxy ? () => config.proxy : null });
const t0 = Date.now();
const origin = new URL(await proxy.start());

async function relayBytes() {
  try {
    const answer = await fetch(`${config.base}/ops/relay/stats`, { headers: { authorization: `Bearer ${config.statsToken}` }, signal: AbortSignal.timeout(5000) });
    const body = await answer.json();
    return body.today.bytesIn + body.today.bytesOut;
  } catch { return null; }
}
const call = (path) => new Promise((resolve) => {
  const started = Date.now();
  const req = request({ host: "127.0.0.1", port: origin.port, path, headers: { host: origin.host } }, (res) => { let size = 0; res.on("data", (c) => { size += c.length; }); res.on("end", () => resolve({ ok: res.statusCode === 200, size, ms: Date.now() - started })); res.on("error", () => resolve({ ok: false, ms: Date.now() - started })); });
  req.setTimeout(30_000, () => req.destroy());
  req.on("error", () => resolve({ ok: false, ms: Date.now() - started }));
  req.end();
});

// as the app's directFor: hello, the ssh key, webrtc and the cloudflare address asked once each over the relay; when
// the hello failed or nothing came back (a captive portal at open), all of it again 15 s later
async function setup() {
  const ways = [];
  const hello = await proxy.control("hello", {}, 15_000).catch(() => null);
  const caps = hello?.caps ?? [];
  if (!config.skip?.includes("ssh") && caps.includes("direct-ssh")) {
    const pair = newDirectKey();
    const answer = await proxy.control("direct-key", { pub: pair.publicKey }, 20_000).catch(() => null);
    if (answer?.host) ways.push({ name: "ssh", connect: sshConnector({ host: answer.host, port: answer.port, user: answer.user, privateKey: pair.privateKey, hostKeys: answer.hostKeys, timeoutMs: 10_000 }) });
  }
  const ndc = loadDataChannel([fileURLToPath(new URL("../../../..", import.meta.url))]);
  if (!config.skip?.includes("rtc") && ndc && caps.includes("direct-rtc")) {
    const connect = rtcConnector({ ndc, signal: (offer) => proxy.control("direct-rtc", { offer }, 15_000), stun: config.stun ?? [], turn: async () => config.turn ?? [] });
    ways.push({ name: "rtc", connect: async () => { const opened = await connect(); log(`rtc ${opened.path} ${opened.pair}`); say({ rtc: opened.pair, rtcPath: opened.path }); return opened; } });
  }
  const wantCf = !config.skip?.includes("cf") && caps.includes("direct-cf");
  const askCf = async () => {
    const url = await proxy.control("direct-cf", {}, 10_000).then((answer) => answer?.url, () => null);
    if (url) ways.push({ name: "cf", connect: wssConnector({ url, spki: null, via: "cf", proxy: config.proxy ? () => config.proxy : null }) });
    return Boolean(url);
  };
  if (wantCf) await askCf();
  say({ ways: ways.map((way) => way.name), setupMs: Date.now() - t0 });
  if (ways.length) proxy.useDirect({ connect: orderedConnect(ways, { log }), pingMs: 5000 });
  if (!hello || !ways.length) { setTimeout(setup, 15_000).unref(); return; }
  // a tunnel still starting: its address joins the running list later (orderedConnect reads it on every dial)
  if (wantCf && !ways.some((way) => way.name === "cf")) {
    const again = async () => { if (await askCf()) say({ ways: ways.map((way) => way.name) }); else setTimeout(again, 15_000).unref(); };
    setTimeout(again, 15_000).unref();
  }
}
void setup();

const waitDirect = async (ms) => { const end = Date.now() + ms; while (Date.now() < end && proxy.transport() !== "direct") await new Promise((resolve) => setTimeout(resolve, 200)); return proxy.transport() === "direct"; };
const direct = await waitDirect(config.waitMs ?? 45_000);
say({ phase: "connected", direct, via: proxy.directVia(), ms: Date.now() - t0 });

async function workload(tag) {
  const before = await relayBytes();
  let ok = 0;
  for (let i = 0; i < 20; i += 1) if ((await call("/api/ping")).ok) ok += 1;
  const big = await call("/api/big?bytes=2000000");
  const after = await relayBytes();
  say({ phase: tag, ok, big: big.ok && big.size === 2_000_000, bigMs: big.ms, relayBytes: before === null || after === null ? null : after - before, via: proxy.directVia(), transport: proxy.transport() });
}
await workload("workload");
process.on("message", async (message) => {
  if (message?.op === "after") {
    const t = Date.now();
    const again = await waitDirect(message.waitMs ?? 60_000);
    say({ phase: "after-connected", direct: again, via: proxy.directVia(), ms: Date.now() - t });
    await workload("after-workload");
  }
  if (message?.op === "close") { await proxy.close(); process.exit(0); }
});
say({ phase: "ready" });
