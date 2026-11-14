import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyPendingDesktopStartFresh, CONFIRM_PHRASE, confirmed, createStartFresh, DESKTOP_MARKER, markDesktopStartFresh } from "./start-fresh.mjs";
import { SERVER_LEASE_NAME } from "./legacy-names.mjs";

function harness({ servers = [{ id: "s1", name: "Oracle box", origin: "https://box.example.test" }], clouds = [{ id: "c1", name: "My cloud" }], signedIn = true, fail = {} } = {}) {
  const calls = [];
  const failing = { ...fail };
  const maybe = (name) => {
    if (failing[name] > 0) { failing[name]--; throw Object.assign(new Error(`${name} is offline`), { code: "offline" }); }
  };
  let account = signedIn ? { email: "tester@qa.dusk.test", clouds } : null;
  const views = [];
  const fresh = createStartFresh({
    servers: () => servers,
    wipeServer: async (server) => { calls.push(`wipe:${server.id}`); maybe(`wipe:${server.id}`); return server.notMine ? "not-owner" : "wiped"; },
    unlinkServer: async (server) => { calls.push(`unlink:${server.id}`); },
    account: () => account,
    cancelPlan: async (id) => { calls.push(`cancel:${id}`); maybe(`cancel:${id}`); },
    deleteAccount: async (email) => { calls.push(`delete:${email}`); maybe("delete"); },
    signOut: async () => { calls.push("signout"); account = null; },
    removeAiKeys: async () => { calls.push("ai"); },
    markLocal: () => calls.push("mark"),
    relaunch: () => calls.push("relaunch"),
    changed: (view) => views.push(view),
  });
  return { fresh, calls, views };
}

test("nothing is deleted until the confirm words are typed, whatever the page sends", async () => {
  assert.equal(confirmed(CONFIRM_PHRASE), true);
  assert.equal(confirmed("  Delete Everything "), true);
  for (const typed of ["", "delete", "delete everything now", null, undefined, 1]) assert.equal(confirmed(typed), false);
  const { fresh, calls } = harness();
  await assert.rejects(fresh.run("delete"), { code: "not_confirmed" });
  assert.deepEqual(calls, []);
  assert.equal(fresh.view().phase, "idle");
});

test("the preview lists what goes without touching anything", () => {
  const { fresh, calls } = harness();
  assert.deepEqual(fresh.preview().steps.map((step) => [step.id, step.status]), [["server:s1", "pending"], ["plan:c1", "pending"], ["account", "pending"], ["ai", "pending"], ["local", "pending"]]);
  assert.deepEqual(calls, []);
});

test("servers first, then each plan cancelled before the account is deleted and signed out, then keys; this computer at the end", async () => {
  const { fresh, calls } = harness();
  const view = await fresh.run(CONFIRM_PHRASE);
  assert.equal(view.phase, "done");
  assert.deepEqual(calls, ["mark", "wipe:s1", "unlink:s1", "cancel:c1", "delete:tester@qa.dusk.test", "signout", "ai"]);
  assert.ok(calls.indexOf("cancel:c1") < calls.indexOf("delete:tester@qa.dusk.test"));
  await fresh.finish();
  assert.equal(calls.at(-1), "relaunch");
  assert.equal(fresh.view().phase, "restarting");
});

test("an offline server doesn't stop the rest; it is listed, and a retry runs only it", async () => {
  const { fresh, calls } = harness({ servers: [{ id: "s1", name: "Box", origin: "https://a.test" }, { id: "s2", name: "Other", origin: "https://b.test" }], fail: { "wipe:s1": 1 } });
  const view = await fresh.run(CONFIRM_PHRASE);
  assert.equal(view.phase, "partial");
  const failed = view.steps.filter((step) => step.status === "failed");
  assert.deepEqual(failed.map((step) => [step.id, step.error]), [["server:s1", "wipe:s1 is offline"]]);
  // it is still linked, so the retry can reach it; everything else went
  assert.ok(!calls.includes("unlink:s1"));
  assert.ok(calls.includes("unlink:s2") && calls.includes("delete:tester@qa.dusk.test") && calls.includes("ai"));
  calls.length = 0;
  const again = await fresh.retry();
  assert.equal(again.phase, "done");
  assert.deepEqual(calls, ["wipe:s1", "unlink:s1"]);
});

test("a plan that wasn't cancelled keeps the account (and its sign-in) until a retry cancels it first", async () => {
  const { fresh, calls } = harness({ fail: { "cancel:c1": 1 } });
  const view = await fresh.run(CONFIRM_PHRASE);
  assert.equal(view.phase, "partial");
  assert.deepEqual(view.steps.filter((step) => step.status === "failed").map((step) => [step.id, step.code]), [["plan:c1", "offline"], ["account", "plan_first"]]);
  assert.ok(!calls.some((call) => call.startsWith("delete:")) && !calls.includes("signout"));
  calls.length = 0;
  await fresh.retry();
  assert.deepEqual(calls, ["cancel:c1", "delete:tester@qa.dusk.test", "signout"]);
});

test("an account that wasn't deleted stays signed in, never half: the retry deletes it and signs out", async () => {
  const { fresh, calls } = harness({ fail: { delete: 1 } });
  const view = await fresh.run(CONFIRM_PHRASE);
  assert.equal(view.steps.find((step) => step.id === "account").status, "failed");
  assert.ok(!calls.includes("signout"));
  await fresh.retry();
  assert.ok(calls.includes("signout"));
  assert.equal(fresh.view().phase, "done");
});

test("someone else's server refuses its wipe and is only forgotten here", async () => {
  const { fresh, calls } = harness({ servers: [{ id: "s1", name: "Friend's", origin: "https://f.test", notMine: true }] });
  const view = await fresh.run(CONFIRM_PHRASE);
  assert.deepEqual(view.steps[0], { id: "server:s1", kind: "server", label: "Friend's", status: "done", note: "unlinked" });
  assert.ok(calls.includes("unlink:s1"));
});

test("signed out: no plan or account steps, the rest still goes", async () => {
  const { fresh } = harness({ signedIn: false, servers: [] });
  assert.deepEqual(fresh.preview().steps.map((step) => step.id), ["ai", "local"]);
  assert.equal((await fresh.run(CONFIRM_PHRASE)).phase, "done");
});

test("a second run while one is going is the same run, and finish waits for a run to end", async () => {
  const { fresh, calls } = harness({ servers: [], clouds: [] });
  const [a, b] = await Promise.all([fresh.run(CONFIRM_PHRASE), fresh.run(CONFIRM_PHRASE)]);
  assert.deepEqual(a, b);
  assert.equal(calls.filter((call) => call.startsWith("delete:")).length, 1);
});

test("finish is refused before a run", async () => {
  const { fresh, calls } = harness();
  await fresh.finish();
  assert.deepEqual(calls, []);
});

test("the next start deletes this computer's data, named local folders and dusk bot's own files, keeping tools, the lease and Chromium's", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "start-fresh-desktop-"));
  try {
    const userData = path.join(root, "userData"), dataDir = path.join(root, ".duskbot"), named = path.join(root, ".duskbot-work"), stranger = path.join(root, "Documents");
    for (const dir of [userData, dataDir, named, stranger, `${dataDir}-clean`, path.join(userData, "cloud-sync"), path.join(userData, "Local Storage"), path.join(dataDir, "tools"), path.join(dataDir, "workspaces")]) fs.mkdirSync(dir, { recursive: true });
    for (const file of ["bots.json", "messages.db", "config.json", SERVER_LEASE_NAME]) fs.writeFileSync(path.join(dataDir, file), "x");
    for (const file of ["credentials.bin", "cloud-account-custom.bin", "vps-link.json", "window-state.json", "Cookies", "Preferences"]) fs.writeFileSync(path.join(userData, file), "x");
    fs.writeFileSync(path.join(userData, "environments.json"), JSON.stringify({ environments: [{ kind: "local", dataDir: named }, { kind: "local", dataDir: stranger }, { kind: "remote", origin: "https://x.test" }] }));
    assert.equal(applyPendingDesktopStartFresh({ userData, dataDir }), false);
    assert.ok(fs.existsSync(path.join(dataDir, "bots.json")));
    markDesktopStartFresh(userData);
    assert.equal(applyPendingDesktopStartFresh({ userData, dataDir }), true);
    assert.deepEqual(fs.readdirSync(dataDir).sort(), [SERVER_LEASE_NAME, "tools"].sort());
    assert.equal(fs.existsSync(named), false);
    assert.equal(fs.existsSync(`${dataDir}-clean`), false);
    // a folder not named like a data folder is never deleted, whatever environments.json says
    assert.equal(fs.existsSync(stranger), true);
    assert.deepEqual(fs.readdirSync(userData).sort(), ["Cookies", "Local Storage", "Preferences", "window-state.json"].sort());
    assert.equal(fs.existsSync(path.join(userData, DESKTOP_MARKER)), false);
    assert.equal(applyPendingDesktopStartFresh({ userData, dataDir }), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
