// the mac stays awake while its linked server uses it (egress, mac control), never on battery, and lets go after a while
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { LINK_AWAKE_BLOCKER, createLinkAwake } from "./vps-link-awake.mjs";
import { createEgressEndpoint } from "./vps-link-egress.mjs";

function fakeBlocker() {
  const started = new Set();
  let next = 1;
  return {
    started,
    types: [],
    start(type) { this.types.push(type); const id = next++; started.add(id); return id; },
    stop(id) { started.delete(id); },
    isStarted: (id) => started.has(id),
  };
}

test("a use holds the mac awake, and it may sleep again once the linger is over", () => {
  let t = 0, battery = false;
  const blocker = fakeBlocker();
  const awake = createLinkAwake({ blocker, onBattery: () => battery, lingerMs: 1000, checkMs: 60_000, now: () => t });
  assert.equal(awake.held(), false);
  awake.touch();
  assert.equal(awake.held(), true);
  assert.deepEqual(blocker.types, [LINK_AWAKE_BLOCKER], "the display may still sleep");
  t = 900;
  awake.touch();
  t = 1800;
  awake.check();
  assert.equal(awake.held(), true, "each use starts the linger over");
  t = 2000;
  awake.check();
  assert.equal(awake.held(), false);
  assert.equal(blocker.started.size, 0);
  battery = true;
  awake.touch();
  assert.equal(awake.held(), false, "never on battery");
  battery = false;
  awake.touch();
  assert.equal(awake.held(), true);
  battery = true;
  awake.check();
  assert.equal(awake.held(), false, "unplugging lets go at once");
  awake.close();
});

test("work the server asked of this mac holds it for as long as it runs", async () => {
  let t = 0, finish;
  const blocker = fakeBlocker();
  const awake = createLinkAwake({ blocker, lingerMs: 1000, checkMs: 60_000, now: () => t });
  const running = awake.busy(new Promise((resolve) => { finish = resolve; }));
  assert.equal(awake.held(), true);
  t = 10_000;
  awake.check();
  assert.equal(awake.held(), true, "a long job keeps it awake past the linger");
  finish("done");
  assert.equal(await running, "done");
  t = 10_500;
  awake.check();
  assert.equal(awake.held(), true);
  t = 11_100;
  awake.check();
  assert.equal(awake.held(), false);
  const off = createLinkAwake({ blocker, enabled: () => false, now: () => t });
  off.touch();
  assert.equal(off.held(), false);
});

test("egress tells the hold about every dial and every piece of a stream", async () => {
  let uses = 0;
  const socket = new PassThrough();
  const sent = [];
  const endpoint = createEgressEndpoint({
    send: (frame) => sent.push(frame), bytes: () => {}, queued: () => 0, onDrain: (resume) => resume(), onUse: () => { uses += 1; },
    dialer: { open: async () => { queueMicrotask(() => {}); return { socket: Object.assign(socket, { setNoDelay() {}, setTimeout() {} }) }; } },
  });
  endpoint.handle({ t: "dial", r: "abcdefghijkl", host: "site.example", port: 443 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sent.some((frame) => frame.t === "dialed" && frame.ok));
  const afterDial = uses;
  assert.ok(afterDial >= 1);
  endpoint.handle({ t: "bytes", r: "abcdefghijkl", b: Buffer.from("hi") });
  socket.write("back");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(uses >= afterDial + 2, "both directions count");
  endpoint.close();
});
