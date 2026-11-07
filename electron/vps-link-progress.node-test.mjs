import assert from "node:assert/strict";
import test from "node:test";

import { createVpsLink } from "./vps-link.mjs";

async function observed(events) {
  let report;
  const finished = new Promise((resolve) => { report = resolve; });
  let watched = false, saved;
  const link = createVpsLink({
    base: "http://fixture.invalid", label: () => "fixture", protect: async (value) => value, unprotect: async (value) => value,
    store: { read: () => null, write: (value) => { saved = value; } },
    onChange: (view) => { if (view.stage === "installing") report(view); },
    fetch: async (url, init) => {
      if (String(url).endsWith("/v1/sessions")) return Response.json({ id: "abcdefghij", watch: "fixture-watch", base: "http://fixture.invalid", expiresAt: Date.now() + 60_000 }, { status: 201 });
      if (!watched) { watched = true; return Response.json({ state: "installing", events: events.map((event, index) => ({ ...event, step: "app", seq: index + 1, at: Date.now() })) }); }
      return new Promise((_resolve, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });
  try {
    await link.start();
    return { view: await finished, saved };
  } finally {
    await link.close();
  }
}

for (const status of ["done", "failed", "skipped"]) {
  for (const [kind, extra] of [
    ["download progress", { progress: { kind: "download", receivedBytes: 10, totalBytes: 20 } }],
    ["activity", { activity: { elapsedMs: 1000, quietMs: 10 } }],
    ["heartbeat", { heartbeat: true, activity: { elapsedMs: 1000, quietMs: 1000 } }],
  ]) {
    test(`late ${kind} cannot revive a ${status} installation step`, { timeout: 2000 }, async () => {
      const { view, saved } = await observed([{ status, ...(status === "failed" ? { log: "preserved failure" } : {}) }, { status: "running", ...extra }]);
      assert.equal(view.steps.find((step) => step.id === "app").status, status);
      assert.equal(saved.pending.steps.app.status, status);
      if (status === "failed") assert.equal(saved.pending.steps.app.log, "preserved failure");
    });
  }
}

test("an explicit installer retry can start a failed step again", { timeout: 2000 }, async () => {
  const { view, saved } = await observed([{ status: "failed", log: "previous failure" }, { status: "running" }]);
  assert.equal(view.steps.find((step) => step.id === "app").status, "running");
  assert.equal(saved.pending.steps.app.status, "running");
  assert.equal(saved.pending.steps.app.log, undefined);
});
