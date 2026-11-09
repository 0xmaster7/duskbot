import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createLinkService } from "../apps/link-service/src/app.mjs";
import { createTunnelAgent } from "../apps/link-service/agent.mjs";
import { createTunnelProxy, openFrame, sha256hex } from "./vps-link-protocol.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const credentials = { id: "abcdefghij", key: Buffer.alloc(32, 7).toString("base64url"), token: "a".repeat(43) };
const key = Buffer.from(credentials.key, "base64url");
const bulk = Buffer.alloc(2 * 1024 * 1024, 9);

async function fixture({ clientFetch = fetch, agentFetch = fetch, replyTimeoutMs = 2000 } = {}) {
  const root = fileURLToPath(new URL("../apps/link-service/", import.meta.url));
  const service = createLinkService({ base: "http://fixture.invalid", scriptPath: `${root}install.sh`, agentPath: `${root}agent.mjs`, trustProxy: false });
  const vpsToken = "v".repeat(43);
  service.store.tunnels.set(credentials.id, { id: credentials.id, vpsVerifier: sha256hex(vpsToken), appVerifier: sha256hex(credentials.token) });
  const relayTimings = [];
  const relay = createServer((req, res) => {
    const start = performance.now();
    let read;
    req.on("end", () => { read = performance.now() - start; });
    res.on("finish", () => { if (req.method === "POST") relayTimings.push({ read: Math.round(read), total: Math.round(performance.now() - start) }); });
    void service.handler(req, res);
  });
  const base = `http://127.0.0.1:${await listen(relay)}`;
  const mutations = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url === "/mutation") mutations.push(Buffer.concat(chunks).toString());
      if (req.url === "/bulk") return res.end(bulk);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const port = await listen(server);
  const agent = createTunnelAgent({ ...credentials, base, token: vpsToken, server: { host: "127.0.0.1", port }, fetchImpl: agentFetch, log: () => {} });
  const running = agent.run();
  const proxy = createTunnelProxy({ ...credentials, base, fetch: clientFetch, replyTimeoutMs, log: () => {} });
  const origin = new URL(await proxy.start());
  const call = (path, body) => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: origin.port, path, method: body === undefined ? "GET" : "POST", headers: { host: origin.host, ...(body === undefined ? {} : { "content-length": Buffer.byteLength(body) }) } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
  return { proxy, mutations, call, relayTimings, close: async () => {
    agent.stop();
    await running;
    await proxy.close();
    service.close();
    relay.closeAllConnections();
    server.closeAllConnections();
    await Promise.all([new Promise((resolve) => relay.close(resolve)), new Promise((resolve) => server.close(resolve))]);
  } };
}

test("a desktop-sized response shares the next relay batch with a new control", { timeout: 5000 }, async (t) => {
  const first = deferred();
  let posts = 0, controlBatch;
  const timings = [];
  const target = await fixture({ agentFetch: async (url, init) => {
    if (init.method === "POST") {
      posts += 1;
      if (posts === 1) first.resolve();
      const frames = JSON.parse(init.body).frames.map((value) => openFrame(key, credentials.id, "to-app", value));
      if (frames.some((frame) => frame.t === "ctl")) controlBatch = posts;
      await delay(40, undefined, { signal: init.signal });
    }
    const started = performance.now();
    const response = await fetch(url, init);
    if (init.method === "POST") timings.push(Math.round(performance.now() - started));
    return response;
  } });
  try {
    const download = target.call("/bulk");
    await first.promise;
    const started = performance.now();
    assert.deepEqual(await target.proxy.control("ping"), { ok: true });
    const elapsed = performance.now() - started;
    assert.equal(controlBatch, 2);
    const result = await download;
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, bulk);
    t.diagnostic(`40 ms per reply POST, 2 MiB response: control in batch ${controlBatch}, ${elapsed.toFixed(1)} ms`);
    t.diagnostic(`reply POST network times: ${timings.join(", ")} ms`);
    t.diagnostic(`relay body read/total times: ${JSON.stringify(target.relayTimings)}`);
  } finally {
    await target.close();
  }
});

test("a lost relay acknowledgment retries the sealed batch without replaying a mutation", { timeout: 5000 }, async (t) => {
  const retried = deferred();
  let attempts = 0, original;
  const target = await fixture({ clientFetch: async (url, init) => {
    const response = await fetch(url, init);
    if (init.method === "POST") {
      attempts += 1;
      if (attempts === 1) { original = init.body; await response.body.cancel(); throw new Error("acknowledgment lost after acceptance"); }
      if (attempts === 2) { assert.equal(init.body, original); retried.resolve(); }
    }
    return response;
  } });
  try {
    assert.equal((await target.call("/mutation", "once")).status, 200);
    await retried.promise;
    assert.deepEqual(await target.proxy.control("ping"), { ok: true });
    assert.deepEqual(target.mutations, ["once"]);
    t.diagnostic("accepted relay batch retried once; server mutation executed once");
  } finally {
    await target.close();
  }
});

test("a lost reply times out its mutation and recovers another request without replay", { timeout: 5000 }, async () => {
  let dropped = false;
  // the long-poll answer an older relay gives: one json document per poll
  const target = await fixture({ replyTimeoutMs: 1000, clientFetch: async (url, init) => {
    const response = await fetch(String(url).replace("&stream=1", ""), init);
    if (init.method === "POST" || !response.ok) return response;
    const body = await response.json();
    if (!dropped && body.frames.length) { dropped = true; throw new Error("reply lost during disconnect"); }
    return Response.json(body);
  } });
  try {
    assert.equal((await target.call("/mutation", "once")).status, 504);
    assert.equal((await target.call("/healthy")).status, 200);
    assert.deepEqual(target.mutations, ["once"]);
  } finally {
    await target.close();
  }
});

test("the next streamed read takes over before the last one ends, so no frame waits through the gap", { timeout: 15_000 }, async (t) => {
  const root = fileURLToPath(new URL("../apps/link-service/", import.meta.url));
  const service = createLinkService({ base: "http://fixture.invalid", scriptPath: `${root}install.sh`, agentPath: `${root}agent.mjs`, trustProxy: false });
  const vpsToken = "v".repeat(43);
  service.store.tunnels.set(credentials.id, { id: credentials.id, vpsVerifier: sha256hex(vpsToken), appVerifier: sha256hex(credentials.token) });
  const relay = createServer((req, res) => void service.handler(req, res));
  const base = `http://127.0.0.1:${await listen(relay)}`;
  let stream = null;
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": open\n\n");
    stream = res;
  });
  const port = await listen(server);
  // every streamed read reaches the relay 150 ms after it is asked for, like a request crossing a long link
  const late = (url, init = {}) => (init.method !== "POST" && String(url).includes("stream=1") ? delay(150).then(() => fetch(url, init)) : fetch(url, init));
  const agent = createTunnelAgent({ ...credentials, base, token: vpsToken, server: { host: "127.0.0.1", port }, fetchImpl: late, log: () => {}, waitS: 1, aheadMs: 500 });
  const running = agent.run();
  const proxy = createTunnelProxy({ ...credentials, base, fetch: late, log: () => {}, waitS: 1, aheadMs: 500 });
  try {
    const origin = new URL(await proxy.start());
    const lags = [];
    const sent = new Map();
    await new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: origin.port, path: "/api/events", headers: { host: origin.host } }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk) => { for (const match of chunk.matchAll(/n=(\d+)/g)) lags.push(performance.now() - sent.get(Number(match[1]))); });
        resolve();
      });
      req.on("error", reject);
      req.end();
    });
    while (!stream) await delay(10);
    await delay(300);
    for (let n = 0; n < 70; n += 1) { sent.set(n, performance.now()); stream.write(`data: n=${n}\n\n`); await delay(50); }
    await delay(300);
    assert.equal(lags.length, 70);
    t.diagnostic(`3.5 s of frames across ~3 read rotations a side: worst ${Math.max(...lags).toFixed(1)} ms`);
    assert.ok(Math.max(...lags) < 100, `a frame waited ${Math.max(...lags).toFixed(1)} ms`);
  } finally {
    agent.stop();
    await running;
    await proxy.close();
    service.close();
    relay.closeAllConnections();
    server.closeAllConnections();
    await Promise.all([new Promise((resolve) => relay.close(resolve)), new Promise((resolve) => server.close(resolve))]);
  }
});
