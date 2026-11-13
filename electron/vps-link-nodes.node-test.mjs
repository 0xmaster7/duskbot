// the app follows its server's tunnel across link service nodes: it asks the node it linked through where the tunnel
// lives, moves there, moves again when that node says it is full or stops answering, and a 404 from a node it moved to
// is not "unlinked" until the node it linked through says so
import assert from "node:assert/strict";
import test from "node:test";

import { createTunnelProxy, openFrame, sealFrame } from "./vps-link-protocol.mjs";

const id = "aaaaaaaaaa", key = Buffer.alloc(32).toString("base64url");
const A = "https://link.example.test", B = "https://link-b.example.test";
const nodes = [{ id: "a", url: A }, { id: "b", url: B }];
const options = { base: A, id, key, token: "fixture-token", follow: true };
const hold = (init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
/** a poll that answers once a control is waiting (read through `take`), or ends when aborted */
const pollFor = (init, take, raw) => new Promise((resolve, reject) => {
  const timer = setInterval(() => { const r = take(); if (r) { clearInterval(timer); resolve(Response.json({ frames: [sealFrame(raw, id, "to-app", { t: "ctl", r, ok: true, data: { ok: true } })] })); } }, 5);
  init.signal.addEventListener("abort", () => { clearInterval(timer); reject(init.signal.reason); }, { once: true });
});
const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((resolve) => setTimeout(resolve, 10)); } };

test("moves to the node the tunnel lives on and sends controls there", { timeout: 5000 }, async () => {
  const seen = [];
  const raw = Buffer.from(key, "base64url");
  let control = null;
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    url = String(url); seen.push(url);
    if (url.endsWith("/node")) return Response.json({ node: "b", url: B, up: true, nodes });
    if (url.startsWith(A)) return hold(init);
    if (url.includes("/to-vps")) { control = openFrame(raw, id, "to-vps", JSON.parse(init.body).frames[0]).r; return Response.json({ ok: true }); }
    return pollFor(init, () => { const r = control; control = null; return r; }, raw);
  } });
  try {
    await proxy.start();
    await until(() => proxy.node() === B);
    assert.deepEqual(await proxy.control("ping"), { ok: true });
    assert.ok(seen.some((url) => url === `${B}/v1/tunnels/${id}/to-vps`));
  } finally { await proxy.close(); }
});

test("a full node (relay_busy) sends the app to ask again, and it follows the server to the node with room", { timeout: 5000 }, async () => {
  const raw = Buffer.from(key, "base64url");
  let home = A, control = null, busyAnswers = 0;
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    url = String(url);
    if (url.endsWith("/node")) return Response.json({ node: home === A ? "a" : "b", url: home, up: true, nodes });
    if (url.startsWith(A) && url.includes("/to-vps")) { busyAnswers += 1; home = B; return Response.json({ error: "The relay is full right now.", code: "relay_busy" }, { status: 503 }); }
    if (url.startsWith(B) && url.includes("/to-vps")) { control = openFrame(raw, id, "to-vps", JSON.parse(init.body).frames[0]).r; return Response.json({ ok: true }); }
    if (url.startsWith(B)) return pollFor(init, () => { const r = control; control = null; return r; }, raw);
    return hold(init);
  } });
  try {
    await proxy.start();
    assert.deepEqual(await proxy.control("ping"), { ok: true });
    assert.equal(busyAnswers, 1);
    assert.equal(proxy.node(), B);
  } finally { await proxy.close(); }
});

test("a 404 from a node it moved to is checked with the node it linked through", { timeout: 8000 }, async () => {
  let originSays = 200;
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    url = String(url);
    if (url.endsWith("/node")) return originSays === 404 ? Response.json({}, { status: 404 }) : Response.json({ node: "b", url: B, up: true, nodes });
    if (url.startsWith(B)) return Response.json({ error: "not found" }, { status: 404 });
    return hold(init);
  } });
  try {
    await proxy.start();
    await until(() => proxy.node() === B);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // the origin still knows the tunnel: a control waits for an answer instead of failing as unlinked
    await assert.rejects(proxy.control("ping", null, 300), /did not answer/);
    originSays = 404;
    await until(() => { void proxy.control("ping", null, 50).catch(() => {}); return false; }, 0).catch(() => {});
    let message = "";
    await until(() => message.includes("not connected"), 6000).catch(() => {});
    for (let i = 0; i < 60 && !message.includes("not connected"); i += 1) {
      message = await proxy.control("ping", null, 100).then(() => "", (error) => error.message);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(message, /not connected/);
  } finally { await proxy.close(); }
});

test("a node that is not the tunnel's home answers 409 moved, and the app goes where it says at once", { timeout: 5000 }, async () => {
  const raw = Buffer.from(key, "base64url");
  let control = null, asked = 0;
  const moved = () => Response.json({ error: "elsewhere", code: "moved", node: "b", url: B, up: true, nodes }, { status: 409 });
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    url = String(url);
    // the node it linked through still says the old home: only the 409 knows better
    if (url.endsWith("/node")) { asked += 1; return Response.json({ node: "a", url: A, up: true, nodes }); }
    if (url.startsWith(A)) return moved();
    if (url.includes("/to-vps")) { control = openFrame(raw, id, "to-vps", JSON.parse(init.body).frames[0]).r; return Response.json({ ok: true }); }
    return pollFor(init, () => { const r = control; control = null; return r; }, raw);
  } });
  try {
    await proxy.start();
    assert.deepEqual(await proxy.control("ping", null, 3000), { ok: true });
    assert.equal(proxy.node(), B);
    assert.equal(asked, 1);
  } finally { await proxy.close(); }
});

test("a request with no answer at all makes the app ask again where the tunnel lives", { timeout: 15000 }, async () => {
  const raw = Buffer.from(key, "base64url");
  let home = A, control = null;
  const proxy = createTunnelProxy({ ...options, fetch: async (url, init) => {
    url = String(url);
    if (url.endsWith("/node")) return Response.json({ node: home === A ? "a" : "b", url: home, up: true, nodes });
    // node a takes posts and never delivers anything: its copy of the directory has not heard the server moved
    if (url.startsWith(A)) return url.includes("/to-vps") ? Response.json({ ok: true }) : hold(init);
    if (url.includes("/to-vps")) { control = openFrame(raw, id, "to-vps", JSON.parse(init.body).frames[0]).r; return Response.json({ ok: true }); }
    return pollFor(init, () => { const r = control; control = null; return r; }, raw);
  } });
  try {
    await proxy.start();
    home = B;
    const answered = proxy.control("ping", null, 14_000);
    // the ping went to a and is lost; the app asks where after 8 s of silence and sends it again to b
    await until(() => proxy.node() === B, 13_000);
    assert.deepEqual(await answered, { ok: true });
    assert.deepEqual(await proxy.control("ping", null, 2000), { ok: true });
  } finally { await proxy.close(); }
});
