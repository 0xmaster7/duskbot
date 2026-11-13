// choosing the way to the server: the ways start together, best first, and the best that connects wins (a lesser one
// that is quicker waits a moment); a link up over a lesser way moves up when a better one comes back, while idle
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";

import { serveDirect } from "../apps/link-service/agent.mjs";
import { createDirectLink, orderedConnect } from "./vps-link-direct.mjs";
import { frameGuard } from "./vps-link-protocol.mjs";

const ID = "aaaaaaaaaa", KEY = Buffer.alloc(32, 7).toString("base64url");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fake = (name, ms, ok = true, log = []) => ({ name, connect: async () => { log.push(name); await sleep(ms); if (!ok) throw new Error(`${name} blocked`); return { name, close() { log.push(`closed ${name}`); } }; } });

test("the best way wins even when a lesser one connects first, and the losers are closed", async () => {
  const log = [];
  const connect = orderedConnect([fake("ssh", 300, true, log), fake("rtc", 50, true, log), fake("cf", 10, true, log)], { network: () => "n", staggerMs: 20, graceMs: 2000 });
  const link = await connect();
  assert.equal(link.via, "ssh");
  await sleep(20);
  assert.ok(log.includes("closed rtc") && log.includes("closed cf"));
});

test("a better way that is too slow loses after the grace, and one that fails at once lets the next start at once", async () => {
  const connect = orderedConnect([fake("ssh", 5000), fake("cf", 10)], { network: () => "n", staggerMs: 1000, graceMs: 100 });
  const started = Date.now();
  assert.equal((await connect()).via, "cf");
  assert.ok(Date.now() - started < 1500, "the stagger and the slow way did not hold it up past the grace");
  const quick = orderedConnect([fake("ssh", 0, false), fake("cf", 10)], { network: () => "n", staggerMs: 5000, graceMs: 100 });
  const at = Date.now();
  assert.equal((await quick()).via, "cf");
  assert.ok(Date.now() - at < 1000);
});

test("the cloud relay is dialled only when nothing else connects; better() tries only the ways above", async () => {
  const log = [];
  const connect = orderedConnect([fake("ssh", 0, false, log), fake("cf", 0, true, log), fake("cloud", 0, true, log)], { network: () => "n", staggerMs: 10 });
  assert.equal((await connect()).via, "cf");
  assert.ok(!log.includes("cloud"));
  log.length = 0;
  assert.equal(await connect.better("ssh"), null);
  const up = await connect.better("cf");
  assert.equal(up, null);
  assert.deepEqual(log.filter((one) => !one.startsWith("closed")), ["ssh"]);
});

test("up over the cloudflare tunnel, the link moves up to ssh once ssh connects again, and not while something rides it", async () => {
  const target = createServer((req, res) => res.end("ok"));
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const server = { host: "127.0.0.1", port: target.address().port };
  let sshUp = false, busy = true;
  const way = (name, up) => ({ name, connect: async () => {
    if (!up()) throw new Error(`${name} blocked`);
    const toAgent = new PassThrough(), toApp = new PassThrough();
    serveDirect({ input: toAgent, output: toApp, id: ID, key: KEY, server, log: () => {} });
    return { readable: toApp, writable: toAgent, close: () => { toAgent.destroy(); toApp.destroy(); } };
  } });
  const connect = orderedConnect([way("ssh", () => sshUp), way("cf", () => true)], { network: () => "n", staggerMs: 10, graceMs: 50 });
  const states = [];
  const link = createDirectLink({ id: ID, key: KEY, guard: frameGuard(), connect, better: connect.better, idle: () => !busy, upgradeMs: [100], onFrame: () => {}, onChange: ({ state }) => states.push(state), log: () => {} });
  link.start();
  try {
    for (let i = 0; i < 100 && !link.ready(); i += 1) await sleep(20);
    assert.equal(link.via(), "cf");
    sshUp = true;
    await sleep(400);
    assert.equal(link.via(), "cf", "busy: it stays where it is");
    busy = false;
    for (let i = 0; i < 100 && link.via() !== "ssh"; i += 1) await sleep(20);
    for (let i = 0; i < 100 && !link.ready(); i += 1) await sleep(20);
    assert.equal(link.via(), "ssh");
    assert.ok(link.ready());
    assert.ok(!states.includes("down"), "moving up is never a loss");
  } finally { link.close(); target.close(); }
});
