import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppUpdater, DESKTOP_MANIFEST_URL, quietNow, RELEASE_KEYS, sumsUrl, verifiedRelease, zipIn, zipUrl } from "./app-update.mjs";

const { privateKey } = generateKeyPairSync("ed25519");
const keys = [{ kid: "test-desk", x: createPublicKey(privateKey).export({ format: "jwk" }).x }];
const sha = (value) => createHash("sha256").update(value).digest("hex");
function manifest(version, sums, kid = "test-desk", key = privateKey) {
  const head = `r1.${kid}.${Buffer.from(JSON.stringify({ v: 1, kind: "desktop", name: "dusk bot", version, sha256: sha(sums), signedAt: 1 })).toString("base64url")}`;
  return { v: 1, version, sha256sums: sha(sums), signature: `${head}.${sign(null, Buffer.from(head), key).toString("base64url")}` };
}

/** a release `version` on the network, its zip `zip`, and an updater around it */
function world({ version = "1.1.0", current = "1.0.0", signed = true, zip = Buffer.from("zip bytes"), sumsZip = zip, manifestKey = privateKey, prepare = async () => {} } = {}) {
  const sums = `${sha(sumsZip)}  DuskBot-${version}-arm64.zip\n${sha("x")}  DuskBot-${version}-x64.zip\n`;
  const routes = new Map([
    [DESKTOP_MANIFEST_URL, JSON.stringify(manifest(version, sums, "test-desk", manifestKey))],
    [sumsUrl(version), sums],
    [zipUrl(version, `DuskBot-${version}-arm64.zip`), zip],
  ]);
  const w = { told: 0, prepared: [], installed: 0, states: [], fetched: [], dir: mkdtempSync(join(tmpdir(), "dusk-app-update-")), quiet: false, timers: [] };
  w.updater = createAppUpdater({
    current, arch: "arm64", dir: w.dir, keys, signed: async () => signed,
    fetchImpl: async (url) => { w.fetched.push(url); const body = routes.get(url); return body === undefined ? new Response("no", { status: 404 }) : new Response(body, { headers: { "content-length": String(Buffer.byteLength(body)) } }); },
    installer: { prepare: async (file, v) => { w.prepared.push({ file, v, bytes: readFileSync(file) }); await prepare(); }, install: () => { w.installed += 1; } },
    quiet: async () => w.quiet, fallback: { check: async () => { w.told += 1; return null; } }, onState: (s) => w.states.push(s),
    timers: { setTimeout: (fn) => { w.timers.push(fn); return w.timers.length; }, clearTimeout: () => {} },
  });
  return w;
}
const done = (w) => rmSync(w.dir, { recursive: true, force: true });

test("pins the same release keys as the service", () => {
  const pinned = readFileSync(new URL("../apps/cloud-service/src/release-signing.ts", import.meta.url), "utf8");
  const service = [...pinned.matchAll(/\{ kid: "([^"]+)", x: "([^"]+)" \}/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(RELEASE_KEYS.map((k) => `${k.kid}:${k.x}`), service);
});

test("a newer signed release is downloaded, checked against the signed sums, and handed to the installer", async () => {
  const w = world();
  assert.equal(await w.updater.check(), "1.1.0");
  assert.equal(w.prepared.length, 1);
  assert.equal(w.prepared[0].v, "1.1.0");
  assert.equal(w.prepared[0].bytes.toString(), "zip bytes");
  assert.deepEqual(w.states.at(0), { ready: null, available: "1.1.0", progress: 0 });
  assert.deepEqual(w.states.at(-1), { ready: "1.1.0", available: "1.1.0", progress: null });
  assert.deepEqual(w.updater.state(), { ready: "1.1.0", available: "1.1.0", progress: null });
  assert.equal(w.told, 0);
  done(w);
});

test("it restarts into the update only at a quiet moment, or when the person asks", async () => {
  const w = world();
  await w.updater.check();
  await w.timers.shift()();
  assert.equal(w.installed, 0);
  w.quiet = true;
  await w.timers.shift()();
  assert.equal(w.installed, 1);
  assert.equal(w.updater.restart(), false);
  done(w);
  const asked = world();
  assert.equal(asked.updater.restart(), false);
  await asked.updater.check();
  assert.equal(asked.updater.restart(), true);
  assert.equal(asked.installed, 1);
  done(asked);
});

test("an unsigned build only tells the person, and downloads nothing", async () => {
  const w = world({ signed: false });
  assert.equal(await w.updater.check(), null);
  assert.equal(w.told, 1);
  assert.deepEqual(w.fetched, []);
  done(w);
});

test("a forged manifest, sums that don't match it, or a zip that doesn't match its sum install nothing and tell the person", async () => {
  const forged = world({ manifestKey: generateKeyPairSync("ed25519").privateKey });
  const swapped = world({ zip: Buffer.from("other bytes"), sumsZip: Buffer.from("zip bytes") });
  for (const w of [forged, swapped]) {
    assert.equal(await w.updater.check(), null);
    assert.equal(w.prepared.length, 0);
    assert.equal(w.told, 1);
    done(w);
  }
});

test("nothing newer, nothing done; an installer that fails falls back to the notice", async () => {
  const same = world({ current: "1.1.0" });
  assert.equal(await same.updater.check(), null);
  assert.equal(same.told, 0);
  done(same);
  const broken = world({ prepare: async () => { throw new Error("Could not get code signature for running application"); } });
  assert.equal(await broken.updater.check(), null);
  assert.equal(broken.told, 1);
  assert.equal(broken.states.some((s) => s.ready), false);
  assert.deepEqual(broken.updater.state(), { ready: null, available: "1.1.0", progress: null });
  done(broken);
});

test("the download's progress reaches the window in whole percents, and a failed one can be tried again", async () => {
  const w = world({ zip: Buffer.alloc(256 * 1024, 7) });
  await w.updater.check();
  const shown = w.states.map((s) => s.progress).filter((p) => p !== null);
  assert.equal(shown[0], 0);
  assert.ok(shown.length > 1 && shown.at(-1) > 0.5, `progress was told: ${shown}`);
  assert.ok(shown.every((p, i) => i === 0 || p > shown[i - 1]), "progress only climbs");
  assert.ok(shown.every((p) => p <= 0.99 && Math.round(p * 100) === p * 100), "whole percents, never 100 before ready");
  done(w);
  let fail = true;
  const retry = world({ prepare: async () => { if (fail) { fail = false; throw new Error("busy"); } } });
  assert.equal(await retry.updater.check(), null);
  assert.deepEqual(retry.updater.state(), { ready: null, available: "1.1.0", progress: null });
  assert.equal(await retry.updater.check(), "1.1.0");
  assert.equal(retry.updater.state().ready, "1.1.0");
  done(retry);
});

test("verifiedRelease and zipIn read only what they vouch for", () => {
  assert.equal(verifiedRelease({ signature: "r1.rel-2026-11.e30.AAAA" }), null);
  assert.equal(verifiedRelease({}), null);
  assert.deepEqual(zipIn(`${"a".repeat(64)}  DuskBot-1.2.3-x64.zip\n`, "1.2.3", "x64"), { name: "DuskBot-1.2.3-x64.zip", sha256: "a".repeat(64) });
  assert.equal(zipIn(`${"a".repeat(64)}  DuskBot-1.2.3-x64.zip\n`, "1.2.3", "arm64"), null);
});

test("quiet: away (locked, or idle and not typing) and nothing running", async () => {
  const signals = (o = {}) => ({ locked: () => false, idleMs: () => 0, typedAt: () => 0, work: async () => null, busy: () => null, ...o });
  const now = 100 * 60_000;
  assert.equal(await quietNow(signals({ locked: () => true }), now), true);
  assert.equal(await quietNow(signals({ idleMs: () => 11 * 60_000 }), now), true);
  assert.equal(await quietNow(signals(), now), false);
  assert.equal(await quietNow(signals({ idleMs: () => 11 * 60_000, typedAt: () => now - 60_000 }), now), false);
  assert.equal(await quietNow(signals({ locked: () => true, work: async () => "bot" }), now), false);
  assert.equal(await quietNow(signals({ locked: () => true, work: async () => { throw new Error("no answer"); } }), now), false);
  assert.equal(await quietNow(signals({ locked: () => true, busy: () => "moving" }), now), false);
});

test("Squirrel.Mac gets the verified zip from a feed on 127.0.0.1 at an unguessable path, closed once it unpacked", async () => {
  const { EventEmitter } = await import("node:events");
  const { squirrelInstaller } = await import("./app-update.mjs");
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "dusk-squirrel-"));
  const file = join(dir, "DuskBot-1.1.0-arm64.zip");
  writeFileSync(file, "the zip");
  const updater = Object.assign(new EventEmitter(), {
    feed: null, quit: 0, got: null, guessed: null,
    setFeedURL({ url, serverType }) { assert.equal(serverType, "json"); this.feed = url; },
    checkForUpdates() {
      void (async () => {
        const feed = await (await fetch(this.feed)).json();
        assert.match(feed.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/update\.zip$/);
        this.guessed = (await fetch(new URL("/update.zip", feed.url))).status;
        this.got = await (await fetch(feed.url)).text();
        this.emit("update-downloaded");
      })().catch((error) => this.emit("error", error));
    },
    quitAndInstall() { this.quit += 1; },
  });
  const installer = squirrelInstaller({ autoUpdater: updater });
  await installer.prepare(file, "1.1.0");
  assert.equal(updater.got, "the zip");
  assert.equal(updater.guessed, 404);
  await assert.rejects(fetch(updater.feed));
  installer.install();
  assert.equal(updater.quit, 1);
  rmSync(dir, { recursive: true, force: true });
});
