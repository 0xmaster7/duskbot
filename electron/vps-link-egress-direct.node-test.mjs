// egress on the fastest live path: the agent's real tunnel (apps/link-service/agent.mjs) and the app's real proxy and
// endpoint, through the real link service, plus an in-memory direct connection handed to the agent's direct hub.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTunnelAgent, listenDirectSocket, openFrame, pipeToTunnel } from "../apps/link-service/agent.mjs";
import { createLinkService, sha256hex } from "../apps/link-service/src/app.mjs";
import { DIRECT_MAGIC, createDirectWriter, directReader } from "./vps-link-direct.mjs";
import { createEgressDialer, createEgressEndpoint } from "./vps-link-egress.mjs";
import { createTunnelProxy, relayFetch } from "./vps-link-protocol.mjs";

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const until = async (check, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const turn = () => new Promise((resolve) => setImmediate(resolve));

test("the egress lane sends while the desktop's window is full, and goes first in each round", async () => {
  const records = [];
  const read = directReader((_type, payload) => records.push(payload.toString("latin1")));
  read(DIRECT_MAGIC);
  const writer = createDirectWriter({ sealFrame: (frame) => Buffer.from(`F:${frame.r}`), sealBytes: (r, bytes) => Buffer.from(`B:${r}:${bytes.length}`), write: (record) => { read(record); return true; }, inflight: 32 * 1024 });
  writer.bytes("desk", Buffer.alloc(1024 * 1024));
  await turn();
  const sent = (r) => records.filter((text) => text.startsWith(`B:${r}:`)).reduce((sum, text) => sum + Number(text.split(":")[2]), 0);
  assert.equal(sent("desk"), 32 * 1024, "the desktop filled its window");
  writer.bytes("hand", Buffer.alloc(40 * 1024), true);
  await turn();
  assert.equal(sent("hand"), 40 * 1024, "the lane did not wait for the desktop's acks");
  writer.bytes("hand", Buffer.alloc(16 * 1024), true);
  writer.acked(16 * 1024);
  await turn();
  const after = records.slice(-2).map((text) => text.split(":")[1]);
  assert.deepEqual(after, ["hand", "desk"], "the lane went first in the round");
  assert.equal(writer.unacked, 32 * 1024 + 56 * 1024);
});

async function socks(port, host, targetPort) {
  const socket = connect({ port, host: "127.0.0.1" });
  socket.on("error", () => {});
  await new Promise((resolve) => socket.once("connect", resolve));
  const reads = [];
  let wake = null;
  socket.on("data", (chunk) => { reads.push(chunk); wake?.(); });
  socket.on("close", () => wake?.());
  const read = async (size) => {
    for (;;) {
      const all = Buffer.concat(reads);
      if (all.length >= size) { reads.length = 0; if (all.length > size) reads.push(all.subarray(size)); return all.subarray(0, size); }
      if (socket.destroyed) return null;
      await new Promise((resolve) => { wake = resolve; });
    }
  };
  socket.write(Buffer.from([5, 1, 0]));
  assert.deepEqual([...await read(2)], [5, 0]);
  const name = Buffer.from(host);
  const request = Buffer.alloc(7 + name.length);
  request.set([5, 1, 0, 3, name.length]);
  name.copy(request, 5);
  request.writeUInt16BE(targetPort, 5 + name.length);
  socket.write(request);
  const reply = await read(10);
  return { socket, reply: reply ? reply[1] : null, read };
}

async function fixture() {
  const root = fileURLToPath(new URL("../apps/link-service/", import.meta.url));
  const service = createLinkService({ base: "http://fixture.invalid", scriptPath: `${root}install.sh`, agentPath: `${root}agent.mjs`, trustProxy: false });
  const credentials = { id: "abcdefghij", key: Buffer.alloc(32, 3).toString("base64url"), token: "a".repeat(43) };
  const vpsToken = "v".repeat(43);
  service.store.tunnels.set(credentials.id, { id: credentials.id, vpsVerifier: sha256hex(vpsToken), appVerifier: sha256hex(credentials.token) });
  const relaySeen = [];
  const relay = createHttpServer((req, res) => void service.handler(req, res));
  // what each end posts to the relay, opened, so a test can tell which path a frame took
  const spied = (dir) => {
    const inner = relayFetch();
    const go = async (url, init = {}) => {
      if (init.method === "POST") for (const sealed of JSON.parse(init.body).frames) relaySeen.push({ dir, frame: openFrame(Buffer.from(credentials.key, "base64url"), credentials.id, dir, sealed) });
      return inner(url, init);
    };
    return Object.assign(go, { connectAware: true, multiplexed: inner.multiplexed, postsInFlight: inner.postsInFlight, close: inner.close, reset: inner.reset });
  };
  const vpsFetch = spied("to-app"), appFetch = spied("to-vps");
  const base = `http://127.0.0.1:${await listen(relay)}`;
  const site = createServer((socket) => { socket.on("error", () => {}); socket.pipe(socket); });
  const sitePort = await listen(site);
  const agent = createTunnelAgent({ ...credentials, base, token: vpsToken, server: { host: "127.0.0.1", port: 9 }, fetchImpl: vpsFetch, log: () => {}, egress: {
    bind: () => ({ host: "127.0.0.1", port: 0, allow: () => true }), reportMs: 100, dialMs: 1500, probe: null,
    report: async () => ({ enabled: true }),
  } });
  const running = agent.run();
  const dialer = createEgressDialer({
    interfaces: () => ({}),
    resolve: async (host) => (host === "site.example" ? [{ address: "93.184.216.34", family: 4 }] : []),
    connect: () => connect({ host: "127.0.0.1", port: sitePort }),
  });
  const links = [];
  const directConnect = async () => {
    const up = new PassThrough(), down = new PassThrough();
    agent.direct.accept(up, down);
    const link = { readable: down, writable: up, close: () => { up.destroy(); down.destroy(); } };
    links.push(link);
    return link;
  };
  const proxy = createTunnelProxy({ ...credentials, base, fetch: appFetch, log: () => {}, direct: { connect: directConnect }, egress: (tunnel) => createEgressEndpoint({ ...tunnel, dialer }) });
  await proxy.start();
  await until(() => agent.egress.listening && agent.egress.online());
  return {
    agent, proxy, links, relaySeen, port: () => agent.egress.listening.port,
    async close() {
      agent.stop();
      await running;
      await proxy.close();
      vpsFetch.close();
      appFetch.close();
      service.close();
      relay.closeAllConnections();
      await Promise.all([new Promise((resolve) => relay.close(resolve)), new Promise((resolve) => site.close(resolve))]);
    },
  };
}

test("with the direct path up, egress dials and bytes ride it, never the relay", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await until(() => f.proxy.transport() === "direct" && f.agent.direct.best());
    const { socket, reply, read } = await socks(f.port(), "site.example", 443);
    assert.equal(reply, 0);
    const payload = Buffer.alloc(200 * 1024, 5);
    socket.write(payload);
    assert.deepEqual(await read(payload.length), payload);
    socket.destroy();
    const egressOnRelay = f.relaySeen.filter(({ frame }) => frame && ["dial", "dialed", "bytes"].includes(frame.t));
    assert.deepEqual(egressOnRelay, [], "no dial, answer or byte of the stream crossed the relay");
  } finally { await f.close(); }
});

test("a lost direct path ends its egress streams, and the next dial takes the relay lane", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await until(() => f.proxy.transport() === "direct" && f.agent.direct.best());
    const first = await socks(f.port(), "site.example", 443);
    assert.equal(first.reply, 0);
    for (const link of f.links) link.close();
    await until(() => f.proxy.transport() === "relay" && !f.agent.direct.best());
    await until(() => first.socket.destroyed || first.socket.readableEnded);
    const second = await socks(f.port(), "site.example", 443);
    assert.equal(second.reply, 0);
    second.socket.write(Buffer.from("over the relay"));
    assert.equal((await second.read(14)).toString(), "over the relay");
    second.socket.destroy();
    const dials = f.relaySeen.filter(({ frame }) => frame?.t === "dial");
    assert.equal(dials.length, 1, "the second dial went over the relay");
  } finally { await f.close(); }
});

test("the direct command hands its connection to the tunnel's process, which serves it in the hub", { timeout: 10_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dusk-direct-sock-"));
  const file = join(dir, "direct.sock");
  const accepted = [];
  const hub = { accept: (input) => { accepted.push(input); input.on("data", (chunk) => input.write(Buffer.concat([Buffer.from("echo:"), chunk]))); } };
  const listening = await listenDirectSocket(hub, file, () => {});
  try {
    assert.ok(listening);
    const input = new PassThrough(), output = new PassThrough();
    const out = [];
    output.on("data", (chunk) => out.push(chunk));
    const exit = pipeToTunnel(file, input, output);
    input.write("hello");
    await until(() => Buffer.concat(out).toString() === "echo:hello");
    assert.equal(accepted.length, 1);
    accepted[0].end();
    assert.equal(await exit, 0);
    assert.equal(await pipeToTunnel(join(dir, "nobody.sock"), new PassThrough(), new PassThrough()), null, "with no tunnel listening, the command serves the connection itself");
  } finally { listening?.close(); rmSync(dir, { recursive: true, force: true }); }
});
