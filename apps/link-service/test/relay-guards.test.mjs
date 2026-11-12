// what keeps the relay from being a free pipe or a memory sink: a tunnel's byte budget, unread frames expiring, one cap
// on every queue together, setup sessions only for a signed dusk account (and a few tunnels each), and per-address limits
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { FRAME_TTL_MS, LANE_BURST_BYTES, LANE_BYTES_PER_SECOND, TUNNELS_PER_ACCOUNT, TUNNEL_BURST_BYTES, TUNNEL_BYTES_PER_DAY, TUNNEL_BYTES_PER_SECOND, createLinkService, sha256hex } from "../src/app.mjs";
import { TUNNEL_IDLE_MS } from "../src/store.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const id = "abcdefghij", vps = "v".repeat(43), app = "a".repeat(43), epoch = "e".repeat(12);
const MB = 1024 * 1024;
let service, server, base, dir, time;

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keys = [{ kid: "test-1", x: publicKey.export({ format: "jwk" }).x }];
const acct = "0123456789abcdef0123456789abcdef";
function grant({ who = acct, iat = time, exp = time + 5 * 60_000, kid = "test-1", key = privateKey } = {}) {
  const head = `l1.${kid}.${Buffer.from(JSON.stringify({ v: 1, aud: "link", acct: who, iat, exp })).toString("base64url")}`;
  return `${head}.${sign(null, Buffer.from(head), key).toString("base64url")}`;
}

async function start(options = {}) {
  time = Date.now();
  dir = mkdtempSync(join(tmpdir(), "dusk-relay-guards-"));
  service = createLinkService({ base: "http://link.test", dataDir: dir, scriptPath: join(root, "install.sh"), agentPath: join(root, "agent.mjs"), trustProxy: true, now: () => time, ...options });
  service.store.tunnels.set(id, { id, createdAt: time, vpsVerifier: sha256hex(vps), appVerifier: sha256hex(app), seenAt: null });
  server = createServer((req, res) => void service.handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  service?.close();
  server?.closeAllConnections();
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
  rmSync(dir, { recursive: true, force: true });
  service = server = null;
});

const request = (path, { token, method = "GET", body, ip = "198.51.100.1" } = {}) => fetch(`${base}${path}`, {
  method, headers: { "x-real-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
/** `count` frames of 1 MiB of base64url text each, 0.75 MiB decoded: the relay charges decoded bytes */
const frames = (count) => Array.from({ length: count }, () => "a".repeat(MB));
const toVps = (list, extra = {}) => request(`/v1/tunnels/${id}/to-vps`, { token: app, method: "POST", body: { frames: list, ...extra } });
const read = () => request(`/v1/tunnels/${id}/to-vps`, { token: vps }).then((res) => res.json());
const newSession = (body = {}, ip) => request("/v1/sessions", { method: "POST", ip, body: { verifier: "f".repeat(64), appPub: "k".repeat(43), ...body } });

describe("a tunnel's byte budget", () => {
  it("takes a burst, refuses past it with a retry-after, and refills at 12 MiB a second", async () => {
    expect([TUNNEL_BYTES_PER_SECOND, TUNNEL_BURST_BYTES]).toEqual([12 * MB, 32 * MB]);
    await start();
    // 2.25 MiB a post: fourteen fit the 32 MiB burst
    for (let i = 0; i < 14; i += 1) { expect((await toVps(frames(3), { epoch, seq: i })).status).toBe(200); await read(); }
    const refused = await toVps(frames(3), { epoch, seq: 14 });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "rate_limited" });
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    time += 1000;
    expect((await toVps(frames(3), { epoch, seq: 14 })).status).toBe(200);
  });

  it("holds the egress lane to 6 MiB a second while the main queue keeps its own room", async () => {
    expect([LANE_BYTES_PER_SECOND, LANE_BURST_BYTES]).toEqual([6 * MB, 8 * MB]);
    await start();
    // three 2.25 MiB posts fit the 8 MiB lane burst, the fourth waits
    for (let i = 0; i < 3; i += 1) { expect((await toVps(frames(3), { lane: true })).status).toBe(200); await read(); }
    expect((await toVps(frames(3), { lane: true })).status).toBe(429);
    expect((await toVps(frames(3), { epoch, seq: 0 })).status).toBe(200);
    time += 1000;
    expect((await toVps(frames(3), { lane: true })).status).toBe(200);
  });

  it("stops a tunnel at 150 GB a day and lets it go again the next UTC day", async () => {
    expect(TUNNEL_BYTES_PER_DAY).toBe(150 * 1024 ** 3);
    await start();
    const tunnel = service.store.tunnels.get(id);
    tunnel.day = Math.floor(time / 86_400_000);
    tunnel.dayBytes = TUNNEL_BYTES_PER_DAY - 1000;
    const refused = await toVps(["a".repeat(4000)], { epoch, seq: 0 });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "daily_limit" });
    time += 86_400_000;
    expect((await toVps(["a".repeat(4000)], { epoch, seq: 0 })).status).toBe(200);
    expect(service.store.tunnels.get(id).dayBytes).toBeLessThan(MB);
  });
});

describe("relay stats", () => {
  it("counts bytes and refusals per tunnel and day, and shows them only with the stats token", async () => {
    const statsToken = "s".repeat(32);
    await start({ statsToken });
    service.store.tunnels.get(id).acct = acct;
    expect((await toVps(frames(3), { epoch, seq: 0 })).status).toBe(200);
    const tunnel = service.store.tunnels.get(id);
    tunnel.day = Math.floor(time / 86_400_000);
    tunnel.dayBytes = TUNNEL_BYTES_PER_DAY;
    expect((await toVps(["a".repeat(4000)], { epoch, seq: 1 })).status).toBe(429);
    expect((await request("/v1/stats/relay")).status).toBe(401);
    expect((await request("/v1/stats/relay", { token: app })).status).toBe(401);
    const res = await request("/v1/stats/relay", { token: statsToken });
    expect(res.status).toBe(200);
    const day = new Date(time).toISOString().slice(0, 10);
    expect(await res.json()).toEqual({ limitBytes: TUNNEL_BYTES_PER_DAY, tunnels: [{ id, acct, days: { [day]: { bytes: Math.floor(3 * MB * 3 / 4), limited: 1 } } }] });
    for (let i = 1; i <= 4; i += 1) { time += 86_400_000; tunnel.dayBytes = 0; expect((await toVps(["a".repeat(4000)], { epoch, seq: 1 + i })).status).toBe(200); await read(); }
    expect(Object.keys(service.store.tunnels.get(id).relayDays)).toHaveLength(3);
  });

  it("hides the route when no stats token is set", async () => {
    await start();
    expect((await request("/v1/stats/relay", { token: "s".repeat(32) })).status).toBe(404);
  });
});

describe("queued frames", () => {
  it("drops frames nobody read within a minute, and gives their room back", async () => {
    await start({ maxQueuedBytes: 3 * MB });
    expect((await toVps(frames(2), { epoch, seq: 0 })).status).toBe(200);
    const full = await toVps(frames(2), { epoch, seq: 1 });
    expect(full.status).toBe(503);
    expect(await full.json()).toMatchObject({ code: "busy" });
    time += FRAME_TTL_MS + 1;
    service.store.sweep();
    expect((await read()).frames).toEqual([]);
    expect((await toVps(frames(2), { epoch, seq: 1 })).status).toBe(200);
  });

  it("counts held out-of-order posts against the cap and frees them when the tunnel goes", async () => {
    await start({ maxQueuedBytes: 3 * MB });
    expect((await toVps(frames(2), { epoch, seq: 5 })).status).toBe(200);
    expect((await toVps(frames(2), { epoch, seq: 6 })).status).toBe(503);
    expect((await request(`/v1/tunnels/${id}`, { token: app, method: "DELETE" })).status).toBe(200);
    service.store.tunnels.set(id, { id, createdAt: time, vpsVerifier: sha256hex(vps), appVerifier: sha256hex(app), seenAt: null });
    expect((await toVps(frames(2), { epoch, seq: 0 })).status).toBe(200);
  });
});

describe("setup sessions need a dusk account", () => {
  it("refuses a session without a valid grant", async () => {
    await start({ grantKeys: keys });
    for (const bad of [undefined, "nope", grant({ exp: time - 10 * 60_000, iat: time - 20 * 60_000 }), grant({ kid: "other" }),
      grant({ key: generateKeyPairSync("ed25519").privateKey }), grant({ exp: time + 60 * 60_000 })]) {
      const refused = await newSession(bad === undefined ? {} : { grant: bad });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ code: "account_required" });
    }
  });

  it("opens one with a grant, and the tunnel it makes belongs to that account", async () => {
    await start({ grantKeys: keys });
    const made = await newSession({ grant: grant() });
    expect(made.status).toBe(201);
    const { id: sid } = await made.json();
    expect(service.store.sessions.get(sid).acct).toBe(acct);
    const token = `${sid}-${"s".repeat(26)}`;
    service.store.sessions.get(sid).vpsVerifier = sha256hex(token);
    expect((await request(`/v1/sessions/${sid}/claim`, { token, method: "POST", body: {} })).status).toBe(200);
    const linked = await request(`/v1/sessions/${sid}/result`, { token, method: "POST", body: { sealed: "c2VhbGVk", vpsPub: "k".repeat(43), tunnel: { vps: "1".repeat(64), app: "2".repeat(64) } } });
    expect(linked.status).toBe(200);
    expect(service.store.tunnels.get(sid).acct).toBe(acct);
  });

  it(`allows ${TUNNELS_PER_ACCOUNT} tunnels per account`, async () => {
    expect(TUNNELS_PER_ACCOUNT).toBe(20);
    await start({ grantKeys: keys });
    for (let i = 0; i < TUNNELS_PER_ACCOUNT; i += 1) { const tid = `acctt${i.toString(36).padStart(2, "0")}aaa`; service.store.tunnels.set(tid, { id: tid, createdAt: time, acct, seenAt: null }); }
    const refused = await newSession({ grant: grant() });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "tunnel_limit" });
    expect((await newSession({ grant: grant({ who: "f".repeat(32) }) })).status).toBe(201);
  });

  it("keeps sessions open to anyone only when no keys are set (local development)", async () => {
    await start();
    expect((await newSession()).status).toBe(201);
  });
});

describe("idle tunnels", () => {
  it("drops a tunnel whose server has not polled for a week", async () => {
    await start();
    time += TUNNEL_IDLE_MS + 1;
    service.store.sweep();
    expect(service.store.tunnels.has(id)).toBe(false);
  });
});

describe("per-address limits", () => {
  it("refuses an address past its request rate, not its neighbours", async () => {
    await start({ ipLimits: { concurrent: 100, perSecond: 1, burst: 5 } });
    for (let i = 0; i < 5; i += 1) expect((await request("/healthz")).status).toBe(200);
    const refused = await request("/healthz");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "rate_limited" });
    expect((await request("/healthz", { ip: "198.51.100.2" })).status).toBe(200);
    time += 1000;
    expect((await request("/healthz")).status).toBe(200);
  });

  it("refuses an address holding too many requests open, and frees the slot when one ends", async () => {
    await start({ ipLimits: { concurrent: 2, perSecond: 100, burst: 100 } });
    const abort = new AbortController();
    const held = [0, 1].map(() => fetch(`${base}/v1/tunnels/${id}/to-vps?wait=20`, { headers: { "x-real-ip": "198.51.100.1", authorization: `Bearer ${vps}` }, signal: abort.signal }).catch(() => null));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await request("/healthz")).status).toBe(429);
    abort.abort();
    await Promise.all(held);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await request("/healthz")).status).toBe(200);
  });
});
