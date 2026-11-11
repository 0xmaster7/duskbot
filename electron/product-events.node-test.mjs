import assert from "node:assert/strict";
import test from "node:test";

import { BATCH, FLUSH_MS, MAX_BACKOFF_MS, MAX_QUEUE, cleanAppEvent, createProductEvents } from "./product-events.mjs";

const INSTALL = "AbCdEfGhIjKlMnOpQrStUv", SESSION = "ZyXwVuTsRqPoNmLkJiHgFe", TOKEN = `omc_${"a".repeat(43)}`;
const NOW = 1_800_000_000_000;

function harness({ token = () => null, statuses = [] } = {}) {
  const calls = [], timers = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = statuses.length ? statuses.shift() : 204;
    if (next === "offline") throw new TypeError("fetch failed");
    return new Response(null, { status: next });
  };
  const events = createProductEvents({ origin: "https://preview.dusk.bot", token, platform: "darwin", version: "1.2.3", fetch, now: () => NOW,
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimer: timer => { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at, 1); }, random: () => 1 });
  return { events, calls, timers };
}
const event = (name = "app_feature", props = { feature: "bot_created" }) => ({ name, at: NOW - 1000, props });

test("posts to the configured account origin with the account token when signed in, the install id either way", async () => {
  let signedIn = null;
  const { events, calls, timers } = harness({ token: () => signedIn });
  events.send({ install: INSTALL, session: SESSION, events: [event()] });
  assert.equal(timers[0].ms, FLUSH_MS);
  await events.flush();
  signedIn = TOKEN;
  events.send({ install: INSTALL, session: SESSION, events: [event("app_screen", { screen: "/settings" })] });
  await events.flush();
  assert.equal(calls[0].url, "https://preview.dusk.bot/v1/app/events");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[1].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(calls[0].body, { install: INSTALL, session: SESSION, platform: "darwin", version: "1.2.3", events: [{ name: "app_feature", at: NOW - 1000, props: { feature: "bot_created" } }] });
  assert.equal(calls[1].body.install, INSTALL);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(events.size(), 0);
});

test("never sends content: unknown events, unknown props and free text are dropped", () => {
  assert.equal(cleanAppEvent({ name: "chat_message", at: NOW, props: { text: "hi" } }, NOW), null);
  assert.equal(cleanAppEvent({ name: "app_feature", at: NOW, props: { feature: "bot_created", message: "x" } }, NOW), null);
  assert.equal(cleanAppEvent({ name: "app_error", at: NOW, props: { kind: "window", code: "please book my flight" } }, NOW), null);
  assert.equal(cleanAppEvent({ name: "app_messages", at: NOW, props: { sent: -1, replies: 1, latencyMs: 2 } }, NOW), null);
  assert.equal(cleanAppEvent({ name: "app_screen", at: NOW, props: { screen: { nested: true } } }, NOW), null);
  assert.deepEqual(cleanAppEvent({ name: "app_close", at: 5, props: { ms: 10 } }, NOW), { name: "app_close", at: NOW, props: { ms: 10 } });
  const { events } = harness();
  assert.equal(events.send({ install: "short", events: [event()] }), false);
  assert.equal(events.send({ install: INSTALL, events: "nope" }), false);
  events.send({ install: INSTALL, events: [event("chat_message", { text: "secret words" }), event()] });
  assert.equal(events.size(), 1);
});

test("retries network failures and server errors with growing backoff, drops what the service rejects", async () => {
  const { events, calls, timers } = harness({ statuses: ["offline", 503, 400, 204] });
  events.send({ install: INSTALL, events: [event()] });
  assert.equal(await events.flush(), false);
  assert.equal(events.size(), 1);
  const first = timers.at(-1).ms;
  assert.equal(first, FLUSH_MS * 2);
  assert.equal(await events.flush(), false);
  assert.equal(timers.at(-1).ms, FLUSH_MS * 4);
  assert.equal(await events.flush(), true);
  assert.equal(events.size(), 0);
  assert.equal(calls.length, 3);
  events.send({ install: INSTALL, events: [event()] });
  assert.equal(timers.at(-1).ms, FLUSH_MS);
});

test("caps backoff and the offline queue, and batches per install and session", async () => {
  const { events, calls, timers } = harness({ statuses: Array(30).fill("offline") });
  for (let n = 0; n < 12; n++) events.send({ install: INSTALL, events: Array.from({ length: 50 }, () => event()) });
  assert.equal(events.size(), MAX_QUEUE);
  for (let n = 0; n < 25; n++) await events.flush();
  assert.equal(timers.at(-1).ms, MAX_BACKOFF_MS);
  assert.equal(calls[0].body.events.length, BATCH);
  const fresh = harness();
  fresh.events.send({ install: INSTALL, session: SESSION, events: [event()] });
  fresh.events.send({ install: "OtherInstallId_00000000", events: [event()] });
  fresh.events.send({ install: INSTALL, session: SESSION, events: [event()] });
  await fresh.events.flush();
  assert.deepEqual(fresh.calls.map(call => [call.body.install, call.body.events.length]), [[INSTALL, 2], ["OtherInstallId_00000000", 1]]);
});

test("clear drops the queue, and close makes one last try then takes nothing more", async () => {
  const { events, calls } = harness();
  events.send({ install: INSTALL, events: [event()] });
  events.clear();
  await events.flush();
  assert.equal(calls.length, 0);
  events.send({ install: INSTALL, events: [event()] });
  await events.close();
  assert.equal(calls.length, 1);
  assert.equal(events.send({ install: INSTALL, events: [event()] }), false);
});
