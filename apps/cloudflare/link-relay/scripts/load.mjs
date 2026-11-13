#!/usr/bin/env node
// load test: many simulated servers and apps through the relay at once.
//   node scripts/load.mjs --url http://127.0.0.1:8946 --key <pkcs8 pem file> --kid load-1 --tunnels 300 --sessions 1 --seconds 30
// each tunnel: a server's standing socket, `sessions` app sockets, and the server's socket per session (as agent.mjs
// does). each app sends a 1 KB message every --every ms; the server echoes it. reports connect and round-trip latency.
// registration is limited to 30 a minute per address: --register-per-minute 29 paces it, and --seconds counts from the
// last tunnel started, so every client is up together for that long.
import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { relayTokenOf, wsConnect, wsDuplex } from "../../../link-service/agent.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, i, all) => (arg.startsWith("--") ? [...out, [arg.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1]]] : out), []));
const url = args.url ?? "http://127.0.0.1:8946";
const tunnels = Number(args.tunnels ?? 300), sessions = Number(args.sessions ?? 1), seconds = Number(args.seconds ?? 30), every = Number(args.every ?? 1000);
const registerPerMinute = Number(args["register-per-minute"] ?? 0);
const privateKey = createPrivateKey(readFileSync(args.key, "utf8"));
const kid = args.kid ?? "load-1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b32 = (n) => Array.from(randomBytes(n), (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte & 31]).join("");

function grant(acct) {
  const t = Date.now();
  const signed = `l1.${kid}.${Buffer.from(JSON.stringify({ v: 1, aud: "link", acct, iat: t, exp: t + 10 * 60_000 })).toString("base64url")}`;
  return `${signed}.${sign(null, Buffer.from(signed), privateKey).toString("base64url")}`;
}

const errors = new Map();
const err = (what, error) => errors.set(`${what}: ${error?.status ?? error?.code ?? error?.message ?? error}`, (errors.get(`${what}: ${error?.status ?? error?.code ?? error?.message ?? error}`) ?? 0) + 1);
const connectMs = [], pairMs = [], rtts = [];
let sent = 0, received = 0, bytes = 0;
const sockets = new Set();
const track = (duplex) => { sockets.add(duplex); duplex.once("close", () => sockets.delete(duplex)); duplex.on("error", () => {}); return duplex; };

async function tunnel(index) {
  const id = b32(10), key = randomBytes(32).toString("base64url"), acct = randomBytes(16).toString("hex");
  const headers = { authorization: `Bearer ${relayTokenOf(key, id)}` };
  const verifier = createHash("sha256").update(relayTokenOf(key, id)).digest("hex");
  const registered = await fetch(`${url}/v1/t/${id}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant: grant(acct), verifier }) });
  if (!registered.ok) { err("register", { status: registered.status }); return; }
  // the server end: echoes each message on the session socket it opens for each app
  try {
    const { socket, head } = await wsConnect(`${url}/v1/t/${id}/vps`, { headers });
    track(wsDuplex(socket, { client: true, head, heartbeatMs: 25_000, onText: (text) => {
      const said = JSON.parse(text);
      if (said.t !== "open") return;
      void wsConnect(`${url}/v1/t/${id}/vps?s=${said.s}`, { headers }).then(({ socket: s, head: h }) => {
        const data = track(wsDuplex(s, { client: true, head: h, heartbeatMs: 25_000 }));
        data.on("data", (chunk) => data.write(chunk));
      }, (error) => err("server session", error));
    } })).resume();
  } catch (error) { err("server", error); return; }
  for (let s = 0; s < sessions; s += 1) void app(id, headers, index);
}

async function app(id, headers) {
  const started = performance.now();
  let duplex;
  try {
    const { socket, head } = await wsConnect(`${url}/v1/t/${id}/app`, { headers });
    connectMs.push(performance.now() - started);
    duplex = track(wsDuplex(socket, { client: true, head, heartbeatMs: 25_000 }));
  } catch (error) { err("app", error); return; }
  const out = new Map();
  let first = true;
  duplex.on("data", (chunk) => {
    received += 1;
    bytes += chunk.length;
    const n = chunk.readUInt32BE(0), at = out.get(n);
    if (at !== undefined) { out.delete(n); const ms = performance.now() - at; if (first) { first = false; pairMs.push(performance.now() - started); } else rtts.push(ms); }
  });
  duplex.once("close", () => { if (!stopping) err("app", new Error("closed early")); });
  let n = 0;
  const payload = randomBytes(1024);
  const tick = () => {
    if (stopping || duplex.destroyed) return;
    payload.writeUInt32BE((n += 1), 0);
    out.set(n, performance.now());
    duplex.write(Buffer.from(payload));
    sent += 1;
    bytes += payload.length;
  };
  tick();
  const timer = setInterval(tick, every * (0.8 + Math.random() * 0.4));
  duplex.once("close", () => clearInterval(timer));
}

let stopping = false;
const pct = (list, p) => { if (!list.length) return null; const sorted = [...list].sort((a, b) => a - b); return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]); };
const t0 = performance.now();
for (let i = 0; i < tunnels; i += 1) {
  void tunnel(i).catch((error) => err("tunnel", error));
  if (registerPerMinute) await sleep(60_000 / registerPerMinute);
  else if (i % 25 === 24) await sleep(50);
}
console.error(`started ${tunnels} tunnels x ${sessions} app sessions in ${Math.round(performance.now() - t0)} ms; running ${seconds} s`);
await sleep(seconds * 1000);
const peak = sockets.size;
stopping = true;
for (const one of sockets) one.destroy();
const report = {
  url, tunnels, sessionsPerTunnel: sessions, clients: tunnels * (1 + sessions), socketsAtPeak: peak, seconds, messageEveryMs: every,
  appConnectMs: { p50: pct(connectMs, 50), p95: pct(connectMs, 95), p99: pct(connectMs, 99), n: connectMs.length },
  firstEchoMs: { p50: pct(pairMs, 50), p95: pct(pairMs, 95), p99: pct(pairMs, 99), n: pairMs.length },
  echoRttMs: { p50: pct(rtts, 50), p95: pct(rtts, 95), p99: pct(rtts, 99), max: rtts.length ? Math.round(Math.max(...rtts)) : null, n: rtts.length },
  messages: { sent, received, lostOrLate: sent - Math.floor(received) }, megabytes: Math.round(bytes / 1e6),
  errors: Object.fromEntries(errors),
};
console.log(JSON.stringify(report, null, 2));
process.exit(0);
