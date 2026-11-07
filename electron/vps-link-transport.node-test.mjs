import assert from "node:assert/strict";
import { request, ServerResponse } from "node:http";
import { connect, Socket } from "node:net";
import { once } from "node:events";
import test from "node:test";

import { createOutbox, createTunnelProxy, openFrame, sealBytes, sealFrame } from "./vps-link-protocol.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const options = { base: "https://link.example.test", id: "aaaaaaaaaa", key: Buffer.alloc(32).toString("base64url"), token: "fixture-token" };

test("closing the tunnel aborts both its pending poll and its pending upload", { timeout: 2000 }, async () => {
  const uploading = deferred();
  const aborted = new Set();
  const proxy = createTunnelProxy({ ...options, fetch: (url, init) => new Promise((_resolve, reject) => {
    const side = String(url).includes("/to-vps") ? "upload" : "poll";
    if (side === "upload") uploading.resolve();
    init.signal.addEventListener("abort", () => { aborted.add(side); reject(init.signal.reason); }, { once: true });
  }) });
  await proxy.start();
  const ping = proxy.control("ping").then(() => assert.fail("no response expected"), (error) => error.message);
  await uploading.promise;
  await proxy.close();
  assert.equal(await ping, "closed");
  assert.deepEqual([...aborted].sort(), ["poll", "upload"]);
});

test("an unlinked tunnel refuses new requests and controls immediately", { timeout: 2000 }, async () => {
  const proxy = createTunnelProxy({ ...options, fetch: async () => Response.json({}, { status: 404 }) });
  const origin = new URL(await proxy.start());
  await tick();
  await assert.rejects(proxy.control("ping"), /not connected/);
  const response = await new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: origin.port, path: "/api/bots", headers: { host: origin.host } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(response, 502);
  await proxy.close();
});

test("outbox cancellation clears queued bytes and releases a paused producer without posting", async () => {
  const abort = new AbortController();
  let posted = false, resumed = false;
  const outbox = createOutbox({ seal: () => "sealed", post: async () => { posted = true; }, delayMs: 1000, signal: abort.signal });
  assert.equal(outbox.bytes("aaaaaaaaaaaa", Buffer.alloc(3 * 1024 * 1024)), false);
  outbox.onDrain(() => { resumed = true; });
  abort.abort();
  await tick();
  assert.equal(outbox.size, 0);
  assert.equal(resumed, true);
  assert.equal(posted, false);
  outbox.push("late");
  outbox.bytes("aaaaaaaaaaaa", Buffer.alloc(10));
  assert.equal(outbox.size, 0);
});

test("a failed outbox post releases backpressure and permits a later flush", { timeout: 2000 }, async () => {
  const drained = deferred();
  const flushed = deferred();
  const errors = [];
  let posted = 0;
  const outbox = createOutbox({
    seal: () => "sealed", delayMs: 0,
    post: async () => { if (++posted === 1) throw new Error("offline"); flushed.resolve(); },
    onError: (error) => errors.push(error.message),
  });
  assert.equal(outbox.bytes("aaaaaaaaaaaa", Buffer.alloc(3 * 1024 * 1024)), false);
  outbox.onDrain(drained.resolve);
  await drained.promise;
  assert.deepEqual(errors, ["offline"]);
  assert.equal(outbox.size, 0);
  outbox.push("later");
  await flushed.promise;
  assert.equal(posted, 2);
});

test("a stalled HTTP response is bounded and cancelled while another response completes", { timeout: 5000 }, async () => {
  const key = Buffer.from(options.key, "base64url");
  const requests = new Map();
  const ready = deferred(), cancelled = deferred(), incoming = deferred();
  let firstPoll = true, maxBuffered = 0;
  const write = ServerResponse.prototype.write;
  ServerResponse.prototype.write = function (...args) {
    const result = write.apply(this, args);
    maxBuffered = Math.max(maxBuffered, this.writableLength);
    return result;
  };
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    if (String(url).includes("/to-vps")) {
      for (const sealed of JSON.parse(init.body).frames) {
        const frame = openFrame(key, options.id, "to-vps", sealed);
        if (frame.t === "req") { requests.set(frame.path, frame.r); if (requests.size === 2) ready.resolve(); }
        if (frame.t === "cancel") cancelled.resolve(frame.r);
      }
      return Response.json({});
    }
    if (firstPoll) { firstPoll = false; return incoming.promise; }
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  let slowReq;
  try {
    const origin = new URL(await proxy.start());
    const slow = new Promise((resolve) => {
      slowReq = request({ host: "127.0.0.1", port: origin.port, path: "/slow", headers: { host: origin.host } }, (res) => {
        res.pause();
        res.on("aborted", resolve);
        res.on("error", resolve);
      });
      slowReq.on("error", resolve);
      slowReq.end();
    });
    const healthy = new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: origin.port, path: "/healthy", headers: { host: origin.host } }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      });
      req.on("error", reject);
      req.end();
    });
    await ready.promise;
    const slowId = requests.get("/slow"), healthyId = requests.get("/healthy");
    const frame = (value) => sealFrame(key, options.id, "to-app", value);
    const chunk = Buffer.alloc(128 * 1024);
    incoming.resolve(Response.json({ frames: [
      frame({ t: "head", r: slowId, status: 200 }),
      ...Array.from({ length: 128 }, () => sealBytes(key, options.id, "to-app", slowId, chunk)),
      frame({ t: "head", r: healthyId, status: 200 }),
      sealBytes(key, options.id, "to-app", healthyId, Buffer.from("healthy")),
      frame({ t: "end", r: healthyId }),
    ] }));
    assert.equal(await healthy, "healthy");
    assert.equal(await cancelled.promise, slowId);
    assert.ok(maxBuffered <= 8 * 1024 * 1024, `buffered ${maxBuffered} bytes`);
    slowReq.destroy();
    await slow;
  } finally {
    slowReq?.destroy();
    await proxy.close();
    ServerResponse.prototype.write = write;
  }
});

test("relay POST bodies are cancelled before the next request reuses the connection", { timeout: 2000 }, async () => {
  let cancelled = 0;
  const response = deferred();
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    if (String(url).includes("/to-vps")) return { ok: true, body: { cancel: async () => { cancelled += 1; response.resolve(); } } };
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  await proxy.start();
  const ping = proxy.control("ping").catch(() => {});
  await response.promise;
  assert.equal(cancelled, 1);
  await proxy.close();
  await ping;
});

test("a stalled desktop socket is bounded and cancelled without blocking HTTP", { timeout: 5000 }, async () => {
  const key = Buffer.from(options.key, "base64url");
  const requests = new Map();
  const ready = deferred(), cancelled = deferred(), incoming = deferred();
  let firstPoll = true, maxBuffered = 0, proxyPort;
  const write = Socket.prototype.write;
  Socket.prototype.write = function (...args) {
    const result = write.apply(this, args);
    if (this.localPort === proxyPort) maxBuffered = Math.max(maxBuffered, this.writableLength);
    return result;
  };
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    if (String(url).includes("/to-vps")) {
      for (const sealed of JSON.parse(init.body).frames) {
        const frame = openFrame(key, options.id, "to-vps", sealed);
        if (frame.t === "req") { requests.set(frame.path, frame.r); if (requests.size === 2) ready.resolve(); }
        if (frame.t === "cancel") cancelled.resolve(frame.r);
      }
      return Response.json({});
    }
    if (firstPoll) { firstPoll = false; return incoming.promise; }
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  let desktop;
  try {
    const origin = new URL(await proxy.start());
    proxyPort = Number(origin.port);
    desktop = connect(proxyPort, "127.0.0.1");
    desktop.on("error", () => {});
    await once(desktop, "connect");
    desktop.write(`GET /desktop HTTP/1.1\r\nHost: ${origin.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
    desktop.pause();
    const healthy = new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: proxyPort, path: "/healthy", headers: { host: origin.host } }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      });
      req.on("error", reject);
      req.end();
    });
    await ready.promise;
    const desktopId = requests.get("/desktop"), healthyId = requests.get("/healthy");
    const frame = (value) => sealFrame(key, options.id, "to-app", value);
    const chunk = Buffer.alloc(128 * 1024);
    incoming.resolve(Response.json({ frames: [
      frame({ t: "head", r: desktopId, status: 101 }),
      ...Array.from({ length: 128 }, () => sealBytes(key, options.id, "to-app", desktopId, chunk)),
      frame({ t: "head", r: healthyId, status: 200 }),
      sealBytes(key, options.id, "to-app", healthyId, Buffer.from("healthy")),
      frame({ t: "end", r: healthyId }),
    ] }));
    assert.equal(await healthy, "healthy");
    assert.equal(await cancelled.promise, desktopId);
    assert.ok(maxBuffered <= 8 * 1024 * 1024, `buffered ${maxBuffered} bytes`);
  } finally {
    desktop?.destroy();
    await proxy.close();
    Socket.prototype.write = write;
  }
});
