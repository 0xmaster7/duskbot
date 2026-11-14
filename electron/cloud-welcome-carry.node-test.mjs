// One welcome only: a cloud opened from this computer's first run (or the website's "you're all set") is marked welcomed.
import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_WELCOME_DONE, carryWelcomeToCloud, welcomeForCloud } from "./cloud-welcome-carry.mjs";
import { CLOUD_WELCOME_DONE as SHARED } from "../shared/cloud-hints.ts";

const NOW = new Date("2026-11-14T10:00:00.000Z");

test("the hint is the one the cloud's welcome reads", () => assert.equal(CLOUD_WELCOME_DONE, SHARED));

test("a new cloud gets the welcome done, the first run counted as met, and this computer's hints with its own", () => {
  const patch = welcomeForCloud({ hintsSeen: ["met-chief"] }, { hintsSeen: ["cloud-welcome-shown"] }, NOW);
  assert.equal(patch.completedAt, NOW.toISOString());
  assert.deepEqual(patch.hintsSeen, ["cloud-welcome-shown", "met-chief", CLOUD_WELCOME_DONE]);
});

test("a finished first run here keeps its date; a cloud whose welcome ended is left alone", () => {
  assert.equal(welcomeForCloud({ completedAt: "2026-11-01T00:00:00.000Z", version: 3 }, null, NOW).completedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(welcomeForCloud({}, { hintsSeen: [CLOUD_WELCOME_DONE] }, NOW), null);
  assert.equal(welcomeForCloud({}, { hintsSeen: ["cloud-setup-hidden"] }, NOW), null);
  assert.deepEqual(welcomeForCloud({}, { completedAt: "2026-10-01T00:00:00.000Z" }, NOW), { hintsSeen: [CLOUD_WELCOME_DONE] });
});

test("writes once over the window's session, and says nothing changed when the cloud doesn't answer", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push([init.method ?? "GET", url, init.body ?? null]); return new Response(JSON.stringify({ onboarding: {} }), { status: 200 }); };
  assert.equal(await carryWelcomeToCloud({ origin: "https://c1.dusk.test", fetch, local: async () => ({ onboarding: {} }), now: () => NOW }), true);
  assert.deepEqual(calls.map(([method, url]) => `${method} ${url}`), ["GET https://c1.dusk.test/api/config", "PUT https://c1.dusk.test/api/config"]);
  assert.ok(JSON.parse(calls[1][2]).onboarding.hintsSeen.includes(CLOUD_WELCOME_DONE));
  assert.equal(await carryWelcomeToCloud({ origin: "https://c1.dusk.test", fetch: async () => new Response("", { status: 401 }), local: async () => null }), false);
});
