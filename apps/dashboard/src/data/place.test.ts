import assert from "node:assert/strict";
import test from "node:test";
import { botFreshness, placeState } from "./place.ts";
import type { CloudDesktop } from "./contracts.ts";

const now = 100 * 3_600_000;
const cloud = (status: CloudDesktop["status"], extra: Partial<CloudDesktop> = {}) => ({ id: "c", status, ...extra }) as CloudDesktop;

test("a dusk cloud we put to sleep reads online; only its owner's pause reads stopped", () => {
  const slept = placeState("offline", now - 16 * 3_600_000, now, cloud("running", { resting: true }));
  assert.deepEqual([slept.label, slept.tone], ["online", "good"]);
  assert.equal(placeState("offline", 0, now, cloud("sleeping")).label, "stopped");
  assert.equal(placeState("offline", 0, now, cloud("stopped")).label, "stopped");
  assert.equal(placeState("live", now, now, cloud("waking")).label, "waking up");
  assert.equal(botFreshness("offline", cloud("running", { resting: true })), undefined);
  assert.equal(botFreshness("offline", cloud("sleeping")), "offline");
});

test("a mac or server that went quiet says when it was last seen, never offline", () => {
  const quiet = placeState("offline", now - 16 * 3_600_000, now, null);
  assert.match(quiet.label, /^last seen /);
  assert.equal(quiet.tone, "quiet");
  assert.doesNotMatch(quiet.label, /offline/);
  assert.equal(placeState("live", now, now).label, "online");
});
