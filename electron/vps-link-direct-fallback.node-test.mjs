// a direct path that cannot connect (an isp dropping ssh to the vps) must cost the relay nothing: requests, sends and the
// live desktop's websocket go over the relay at once, and the dead port is tried less and less often
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect as netConnect, createServer as createTcpServer } from "node:net";
import test, { mock } from "node:test";

import { createServing } from "../link-service/agent.mjs";
import { BACKOFF_MS, createDirectLink, networkFingerprint, newDirectKey, sshConnector } from "./vps-link-direct.mjs";
import { createTunnelProxy, openFrame, sealFrame } from "./vps-link-protocol.mjs";

const ID = "aaaaaaaaaa";
const KEY = Buffer.alloc(32, 7).toString("base64url");
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** a fake server behind a healthy fake relay, and a tunnel proxy whose direct path dials with `connect` */
async function rig(connect, directOptions = {}) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/events") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: one\n\n"); return; }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${req.method} ${req.url} ${body}`);
    });
  });
  const upgraded = new Set();
  server.on("upgrade", (req, socket) => {
    upgraded.add(socket);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (chunk) => socket.write(chunk));
  });
  const target = { host: "127.0.0.1", port: await listen(server) };
  const replies = [];
  let wake = null;
  const sealed = (frame) => sealFrame(Buffer.from(KEY, "base64url"), ID, "to-app", frame);
  const serving = createServing({ server: target, sink: {
    push: (frame) => { replies.push(sealed(frame)); wake?.(); },
    bytes: (r, chunk) => { replies.push(sealed({ t: "data", r, d: chunk.toString("base64") })); wake?.(); return true; },
    onDrain: (resume) => resume(), discard: () => {},
  } });
  const relayed = [];
  const fakeFetch = async (url, init = {}) => {
    if (init.method === "POST") {
      for (const one of JSON.parse(init.body).frames) { const frame = openFrame(Buffer.from(KEY, "base64url"), ID, "to-vps", one); relayed.push(frame); void serving.handle(frame); }
      return new Response('{"ok":true,"ordered":true}');
    }
    if (!replies.length) await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 200); init.signal?.addEventListener("abort", resolve, { once: true }); });
    if (init.signal?.aborted) throw new Error("aborted");
    return new Response(JSON.stringify({ frames: replies.splice(0) }), { headers: { "content-type": "application/json" } });
  };
  const proxy = createTunnelProxy({ base: "https://relay.test", id: ID, key: KEY, token: "t", fetch: fakeFetch, direct: { connect }, directFactory: (options) => createDirectLink({ ...options, ...directOptions }) });
  const origin = new URL(await proxy.start());
  const timed = (path, method = "GET", body) => new Promise((resolve, reject) => {
    const started = Date.now();
    const req = request({ host: "127.0.0.1", port: origin.port, path, method, headers: { host: origin.host } }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk;
        // an event stream never ends: its first event is the answer
        if (path === "/events") { resolve({ status: res.statusCode, text, ms: Date.now() - started }); res.destroy(); }
      });
      res.on("end", () => resolve({ status: res.statusCode, text, ms: Date.now() - started }));
    });
    req.on("error", reject);
    req.end(body);
  });
  const upgrade = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = netConnect({ host: "127.0.0.1", port: Number(origin.port) }, () => socket.write(`GET /desktop HTTP/1.1\r\nHost: ${origin.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`));
    socket.once("data", (chunk) => {
      const status = chunk.toString("latin1").split("\r\n")[0];
      socket.write("echo-me");
      socket.once("data", (echo) => { resolve({ status, echo: echo.toString(), ms: Date.now() - started }); socket.destroy(); });
    });
    socket.on("error", reject);
  });
  const close = async () => { await proxy.close(); server.closeAllConnections(); for (const socket of upgraded) socket.destroy(); await new Promise((resolve) => server.close(resolve)); };
  return { proxy, timed, upgrade, relayed, close };
}

for (const [name, connect] of [
  ["times out", () => new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out while waiting for handshake")), 1500))],
  ["hangs", () => new Promise(() => {})],
]) {
  test(`direct connect ${name}: requests, a send, the event stream and the desktop's websocket ride the relay without waiting for it`, { timeout: 20_000 }, async () => {
    const r = await rig(connect, { connectMs: 1500 });
    try {
      // first use, while the direct path is still dialling
      const [get, post, events, ws] = await Promise.all([r.timed("/api/chats"), r.timed("/api/send", "POST", "hello"), r.timed("/events"), r.upgrade()]);
      assert.equal(get.text, "GET /api/chats ");
      assert.equal(post.text, "POST /api/send hello");
      assert.match(events.text, /data: one/);
      assert.match(ws.status, /^HTTP\/1\.1 101/);
      assert.equal(ws.echo, "echo-me");
      for (const one of [get, post, events]) assert.ok(one.ms < 500, `a request waited ${one.ms} ms`);
      assert.ok(ws.ms < 1000, `the first websocket waited ${ws.ms} ms for a direct path that never came`);
      // once the dial failed, nothing waits for it at all
      await sleep(1800);
      assert.equal(r.proxy.transport(), "relay");
      const again = await Promise.all([r.upgrade(), r.upgrade(), r.timed("/api/send", "POST", "again")]);
      for (const one of again) assert.ok(one.ms < 300, `waited ${one.ms} ms once the direct path was known down`);
      assert.ok(r.relayed.filter((frame) => frame.t === "req" && frame.up).length >= 3, "every websocket went over the relay");
    } finally { await r.close(); }
  });
}

test("a blocked ssh port backs off to twice an hour, a wake on the same network does not redial, a new network does", { timeout: 20_000 }, async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let net = "en0 192.168.1.5", dials = 0;
  const link = createDirectLink({ id: ID, key: KEY, guard: () => true, onFrame: () => {}, network: () => net,
    connect: async () => { dials += 1; throw Object.assign(new Error("the server's ssh port did not answer"), { code: "ETIMEDOUT" }); } });
  const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
  const advance = async (ms, step = 1000) => { for (let at = 0; at < ms; at += step) { mock.timers.tick(step); await flush(); } };
  try {
    link.start();
    await flush();
    assert.equal(dials, 1);
    assert.equal(link.failing(), true);
    await advance(2 * 60 * 60_000, 5000);
    // 1 s, 5 s, 15 s, 1 min, 3 min, 10 min, then every 30 min: a handful of tries in two hours, not ninety
    assert.ok(dials >= 8 && dials <= 11, `${dials} dials in two hours`);
    assert.equal(BACKOFF_MS.at(-1), 30 * 60_000);
    const before = dials;
    link.nudge();
    await flush();
    assert.equal(dials, before, "a wake on the same network keeps the backoff");
    net = "en0 10.0.0.7";
    link.nudge();
    await flush();
    assert.equal(dials, before + 1, "a new network dials at once");
    await advance(1000);
    assert.equal(dials, before + 2, "and starts the backoff over");
    // a network change with no wake is noticed while waiting out a long backoff
    await advance(10 * 60_000, 5000);
    const settled = dials;
    net = "en1 172.20.10.2";
    await advance(15_000);
    assert.ok(dials > settled, "the move was noticed within the watch interval");
  } finally {
    link.close();
    mock.timers.reset();
  }
});

test("the fingerprint ignores loopback, link-local and rotating ipv6 privacy addresses", () => {
  const a = networkFingerprint({
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    en0: [{ address: "192.168.1.5", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }, { address: "2405:201:1:2:aaaa:bbbb:cccc:dddd", family: "IPv6", internal: false }],
  });
  const b = networkFingerprint({ en0: [{ address: "192.168.1.5", family: "IPv4", internal: false }, { address: "2405:201:1:2:1111:2222:3333:4444", family: "IPv6", internal: false }] });
  assert.equal(a, b);
  assert.notEqual(a, networkFingerprint({ en0: [{ address: "192.168.1.6", family: "IPv4", internal: false }] }));
});

test("an ssh port that never greets is given up in seconds, not after the 20 s handshake timeout", { timeout: 20_000 }, async () => {
  const sockets = new Set();
  const silent = createTcpServer((socket) => { sockets.add(socket); socket.on("error", () => {}); });
  const port = await listen(silent);
  try {
    const started = Date.now();
    const dial = sshConnector({ host: "127.0.0.1", port, user: "x", privateKey: newDirectKey().privateKey, hostKeys: ["ssh-ed25519 AAAA"], bannerMs: 300 });
    const outcome = await Promise.race([dial().then(() => "connected", (error) => error), sleep(3000).then(() => "hung")]);
    assert.equal(outcome?.code, "ETIMEDOUT", String(outcome));
    assert.equal(outcome.level, "client-timeout", "not mistaken for a key the server dropped");
    assert.ok(Date.now() - started < 1500);
  } finally {
    for (const socket of sockets) socket.destroy();
    silent.close();
  }
});
