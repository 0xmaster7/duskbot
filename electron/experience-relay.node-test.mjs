import assert from "node:assert/strict";
import test from "node:test";
import { crashProps, createExperienceRelay, updateFailStage } from "./experience-relay.mjs";

function events(install) {
  const sent = [];
  return { sent, install: () => install, action: (name, props, at) => { sent.push({ name, props, at }); return true; } };
}
const answer = (body, ok = true) => ({ ok, json: async () => body, body: { cancel: async () => {} } });

test("hands each experience signal to the product events with its own time", async () => {
  const sink = events("inst_abcdefghijklmnop");
  const asked = [];
  const relay = createExperienceRelay({ events: sink, setTimer: () => null, clearTimer: () => {},
    localRequest: async (path) => { asked.push(path); return answer({ signals: [{ name: "turn_failed", at: 123, props: { engine: "claude", reason: "timeout" } }, { name: "Bad Name", props: {} }] }); } });
  assert.equal(await relay.run(), 1);
  assert.deepEqual(asked, ["/api/dashboard/experience"]);
  assert.deepEqual(sink.sent, [{ name: "turn_failed", props: { engine: "claude", reason: "timeout" }, at: 123 }]);
  relay.close();
});

test("takes nothing while the page sends no events of its own (usage analytics off)", async () => {
  const sink = events(null);
  let asked = 0;
  const relay = createExperienceRelay({ events: sink, setTimer: () => null, clearTimer: () => {}, localRequest: async () => { asked++; return answer({ signals: [] }); } });
  assert.equal(await relay.run(), 0);
  assert.equal(asked, 0);
});

test("crashes and update failures become fixed words", () => {
  assert.deepEqual(crashProps("page", "crashed"), { kind: "page", reason: "crashed" });
  assert.deepEqual(crashProps("GPU", "launch-failed"), { kind: "gpu", reason: "launch_failed" });
  assert.equal(crashProps("page", "clean-exit"), null);
  assert.equal(updateFailStage("the update did not match its checksum"), "checksum");
  assert.equal(updateFailStage("the release manifest is not signed by a pinned key"), "manifest");
  assert.equal(updateFailStage("fetch failed"), "download");
});
