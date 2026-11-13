// a reply or body that lost bytes between the app and the server (a node restarted, a read cut off mid-line) fails
// instead of arriving short or with a hole in it: each end counts what it sent and the other checks
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import { createServing } from "../apps/link-service/agent.mjs";
import { createTunnelProxy, openFrame, sealBytes, sealFrame } from "./vps-link-protocol.mjs";

const id = "aaaaaaaaaa", key = Buffer.alloc(32, 7).toString("base64url"), raw = Buffer.from(key, "base64url");

/** a relay whose to-app reads hand out whatever `reply(r)` makes for each request the app posts */
function fakeRelay(reply) {
  const out = [];
  let wake = null;
  const fetch = async (url, init) => {
    url = String(url);
    if (url.endsWith("/to-vps")) {
      for (const sealed of JSON.parse(init.body).frames) {
        const frame = openFrame(raw, id, "to-vps", sealed);
        if (frame?.t === "req") out.push(...reply(frame.r));
      }
      wake?.();
      return Response.json({ ok: true });
    }
    if (!out.length) await new Promise((resolve) => { wake = resolve; init.signal?.addEventListener("abort", resolve, { once: true }); setTimeout(resolve, 200); });
    return Response.json({ frames: out.splice(0) });
  };
  return fetch;
}
const head = (r) => sealFrame(raw, id, "to-app", { t: "head", r, status: 200, headers: { "content-type": "application/octet-stream" } });
const bytes = (r, size) => sealBytes(raw, id, "to-app", r, Buffer.alloc(size, 1));
const end = (r, n) => sealFrame(raw, id, "to-app", { t: "end", r, ...(n === undefined ? {} : { n }) });
const mark = (r, n) => sealFrame(raw, id, "to-app", { t: "mark", r, n });

function get(proxy) {
  const origin = new URL(proxy.origin());
  return new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port: origin.port, path: "/file", headers: { host: origin.host } }, (res) => {
      let size = 0;
      res.on("data", (chunk) => { size += chunk.length; });
      res.on("end", () => resolve({ status: res.statusCode, size, complete: true }));
      res.on("error", () => resolve({ status: res.statusCode, size, complete: false }));
      res.on("aborted", () => resolve({ status: res.statusCode, size, complete: false }));
    });
    req.on("error", () => resolve({ status: 0, complete: false }));
    req.end();
  });
}

test("a reply that ends with fewer bytes than the server sent is cut off, not finished", { timeout: 5000 }, async () => {
  const proxy = createTunnelProxy({ base: "http://relay.test", id, key, token: "t", fetch: fakeRelay((r) => [head(r), bytes(r, 100), end(r, 200)]) });
  try {
    await proxy.start();
    const answer = await get(proxy);
    assert.equal(answer.complete, false);
  } finally { await proxy.close(); }
});

test("a long reply whose mark shows a hole is cut off at the mark", { timeout: 5000 }, async () => {
  const proxy = createTunnelProxy({ base: "http://relay.test", id, key, token: "t", fetch: fakeRelay((r) => [head(r), bytes(r, 100), mark(r, 300), bytes(r, 100), end(r, 400)]) });
  try {
    await proxy.start();
    const answer = await get(proxy);
    assert.equal(answer.complete, false);
  } finally { await proxy.close(); }
});

test("a whole reply, or one from an agent that does not count, finishes as before", { timeout: 5000 }, async () => {
  for (const n of [200, undefined]) {
    const proxy = createTunnelProxy({ base: "http://relay.test", id, key, token: "t", fetch: fakeRelay((r) => [head(r), bytes(r, 100), mark(r, 100), bytes(r, 100), end(r, n)]) });
    try {
      await proxy.start();
      assert.deepEqual(await get(proxy), { status: 200, size: 200, complete: true });
    } finally { await proxy.close(); }
  }
});

test("the agent ends an upload that lost bytes on the way and says so, and sends its own counts", async () => {
  const frames = [];
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => { req.on("data", () => {}); req.on("end", () => { res.end("ok"); }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serving = createServing({ server: { host: "127.0.0.1", port: server.address().port }, sink: { push: (frame) => frames.push(frame), bytes: (r, chunk) => { frames.push({ t: "bytes", r, b: chunk }); return true; }, onDrain: (resume) => resume(), discard: () => {} } });
  try {
    await serving.handle({ t: "req", r: "uploadaaaaaa", method: "POST", path: "/up", headers: {}, end: false });
    await serving.handle({ t: "bytes", r: "uploadaaaaaa", b: Buffer.alloc(10) });
    await serving.handle({ t: "body", r: "uploadaaaaaa", end: true, n: 20 });
    assert.deepEqual(frames.find((frame) => frame.t === "err"), { t: "err", r: "uploadaaaaaa", message: "Part of this request was lost on the way. Try again." });

    await serving.handle({ t: "req", r: "uploadbbbbbb", method: "POST", path: "/up", headers: {}, end: false });
    await serving.handle({ t: "bytes", r: "uploadbbbbbb", b: Buffer.alloc(10) });
    await serving.handle({ t: "body", r: "uploadbbbbbb", end: true, n: 10 });
    for (let i = 0; i < 100 && !frames.some((frame) => frame.t === "end" && frame.r === "uploadbbbbbb"); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(frames.find((frame) => frame.t === "end" && frame.r === "uploadbbbbbb"), { t: "end", r: "uploadbbbbbb", n: 2 });
  } finally { server.close(); }
});

test("a post given up starts a new epoch, so the relay never waits out its hole before later posts", { timeout: 20_000 }, async () => {
  const epochs = [];
  let refuse = true;
  const fetch = async (url, init) => {
    url = String(url);
    if (url.endsWith("/to-vps")) {
      const body = JSON.parse(init.body);
      epochs.push(body.epoch);
      return refuse ? Response.json({ error: "busy", code: "busy" }, { status: 503 }) : Response.json({ ok: true, ordered: true });
    }
    await new Promise((resolve) => { init.signal?.addEventListener("abort", resolve, { once: true }); setTimeout(resolve, 200); });
    return Response.json({ frames: [] });
  };
  const proxy = createTunnelProxy({ base: "http://relay.test", id, key, token: "t", fetch });
  try {
    await proxy.start();
    await assert.rejects(proxy.control("ping", null, 15_000), /could not be reached/);
    refuse = false;
    void proxy.control("ping", null, 1000).catch(() => {});
    for (let i = 0; i < 100 && new Set(epochs).size < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(new Set(epochs).size, 2);
  } finally { await proxy.close(); }
});
