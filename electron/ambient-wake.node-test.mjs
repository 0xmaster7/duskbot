import assert from "node:assert/strict";
import test from "node:test";
import { createTurnClock } from "./ambient-wake.mjs";

const bot = (status, fields = {}) => ({ id: "nova", threadId: "t1", status, at: 1, ...fields });
const summary = (...bots) => ({ bots, labels: {}, lang: "en" });

test("a finished reply or failure carries how long the turn that ended in it ran", () => {
  let now = 1_000;
  const stamp = createTurnClock(() => now);
  stamp(summary(bot("idle")));
  stamp(summary(bot("working")));
  now += 30_000;
  stamp(summary(bot("needs-you", { waits: "approval" })));
  now += 150_000;
  stamp(summary(bot("talking")));
  now += 5_000;
  const done = stamp(summary(bot("done", { at: now, unread: true })));
  assert.equal(done.bots[0].ran, 185_000);
  // the same news in the next summary keeps it; a new message without a turn seen running does not
  assert.equal(stamp(summary(bot("done", { at: now, unread: true }))).bots[0].ran, 185_000);
  assert.equal(stamp(summary(bot("done", { at: now + 9, unread: true }))).bots[0].ran, undefined);
  now += 1_000;
  stamp(summary(bot("working")));
  now += 2_000;
  assert.equal(stamp(summary(bot("error", { at: now }))).bots[0].ran, 2_000);
});

test("the turn's own start wins over when main first saw it, and the first summary is how things stand", () => {
  let now = 500_000;
  const stamp = createTurnClock(() => now);
  assert.equal(stamp(summary(bot("done", { at: 9 }))).bots[0].ran, undefined);
  stamp(summary(bot("working", { since: now - 200_000 })));
  now += 1_000;
  assert.equal(stamp(summary(bot("done", { at: now }))).bots[0].ran, 201_000);
  // an ask on its own (no turn seen running before it) starts no clock
  const fresh = createTurnClock(() => now);
  fresh(summary(bot("needs-you")));
  assert.equal(fresh(summary(bot("done", { at: 3 }))).bots[0].ran, undefined);
});
