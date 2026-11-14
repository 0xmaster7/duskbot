// the mac app installs its own updates. dusk.bot's signed latest.json names the version and the sha256 of that
// release's SHA256SUMS; the zip for this mac's arch is downloaded from the public downloads repo, checked against those
// sums, and handed to Electron's autoUpdater (Squirrel.Mac) through a feed on 127.0.0.1 that only this process knows.
// Squirrel.Mac installs only an app signed with the same Developer ID as the running one (its designated requirement),
// so an unsigned or ad-hoc build keeps the old behaviour: one notification that opens the download page.
// a downloaded update installs when the app quits, or at a quiet moment (locked, or idle with no work running), and the
// app shows "restart to update" while it waits.
import { execFile } from "node:child_process";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const DESKTOP_MANIFEST_URL = "https://dusk.bot/releases/latest.json";
export const sumsUrl = (version) => `https://dusk.bot/releases/${version}/SHA256SUMS`;
export const zipUrl = (version, name) => `https://github.com/DuskBotAI/duskbot-releases/releases/download/v${version}/${name}`;
/** CI's release keys (apps/cloud-service/src/release-signing.ts pins the same ones; a test keeps them equal) */
export const RELEASE_KEYS = Object.freeze([{ kid: "rel-2026-11", x: "wtwZypDwVPBXZ25XsZOVpd0PZPBbVMhugheUj5_NLIM" }]);
const HOUR_MS = 60 * 60_000;
/** each check lands somewhere in this much more, so every app does not ask dusk.bot in the same minute */
const JITTER_MS = 15 * 60_000;
export const QUIET_IDLE_MS = 10 * 60_000;

/** `{ version, sums }` from a desktop release manifest signed by a pinned key, or null */
export function verifiedRelease(body, keys = RELEASE_KEYS) {
  const parts = typeof body?.signature === "string" ? body.signature.trim().split(".") : [];
  if (parts.length !== 4 || parts[0] !== "r1" || !/^[A-Za-z0-9_-]+$/.test(parts[2]) || !/^[A-Za-z0-9_-]+$/.test(parts[3])) return null;
  const key = keys.find((item) => item.kid === parts[1]);
  if (!key) return null;
  try {
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.x }, format: "jwk" });
    if (!verify(null, Buffer.from(parts.slice(0, 3).join(".")), publicKey, Buffer.from(parts[3], "base64url"))) return null;
    const m = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
    if (m.v !== 1 || m.kind !== "desktop" || !/^\d+\.\d+\.\d+$/.test(m.version ?? "") || !/^[0-9a-f]{64}$/.test(m.sha256 ?? "")) return null;
    return { version: m.version, sums: m.sha256 };
  } catch {
    return null;
  }
}

/** a > b for plain x.y.z versions */
export function newer(a, b) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value))?.slice(1).map(Number);
  const left = parse(a), right = parse(b);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}

/** this arch's zip in a SHA256SUMS text: `{ name, sha256 }`, or null */
export function zipIn(sums, version, arch) {
  const name = `DuskBot-${version}-${arch}.zip`;
  for (const line of String(sums).split("\n")) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line.trim());
    if (match && match[2] === name) return { name, sha256: match[1] };
  }
  return null;
}

/**
 * whether the running app is signed with a Developer ID (the only kind Squirrel.Mac will update): `codesign -dv` on the
 * bundle names a Developer ID Application authority and a team
 */
export function developerIdSigned(bundle, run = (file, args) => new Promise((resolve) => execFile(file, args, { timeout: 15_000 }, (_error, stdout, stderr) => resolve(`${stdout}\n${stderr}`)))) {
  return run("/usr/bin/codesign", ["-dv", "--verbose=4", bundle]).then((out) => /^Authority=Developer ID Application: /m.test(out) && /^TeamIdentifier=[A-Z0-9]{10}$/m.test(out), () => false);
}

/**
 * Squirrel.Mac fed from 127.0.0.1: a feed and the verified zip at an unguessable path, for one download, closed after.
 * `autoUpdater` is Electron's.
 */
export function squirrelInstaller({ autoUpdater, timeoutMs = 15 * 60_000 }) {
  return {
    async prepare(file, version) {
      const token = randomBytes(16).toString("hex"), size = statSync(file).size;
      let port = 0;
      const server = createServer((req, res) => {
        if (req.method === "GET" && req.url === `/${token}/feed.json`) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/${token}/update.zip`, name: version }));
        }
        if (req.method === "GET" && req.url === `/${token}/update.zip`) {
          res.writeHead(200, { "content-type": "application/zip", "content-length": String(size) });
          return void pipeline(createReadStream(file), res).catch(() => {});
        }
        res.writeHead(404).end();
      });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      port = server.address().port;
      let done, failed;
      const settled = new Promise((resolve, reject) => { done = resolve; failed = reject; });
      const timer = setTimeout(() => failed(new Error("the update did not unpack in time")), timeoutMs);
      autoUpdater.once("update-downloaded", done);
      autoUpdater.once("error", failed);
      try {
        autoUpdater.setFeedURL({ url: `http://127.0.0.1:${port}/${token}/feed.json`, serverType: "json" });
        autoUpdater.checkForUpdates();
        await settled;
      } finally {
        clearTimeout(timer);
        autoUpdater.removeListener("update-downloaded", done);
        autoUpdater.removeListener("error", failed);
        server.close();
      }
    },
    install() { autoUpdater.quitAndInstall(); },
  };
}

/**
 * quiet enough to restart: nothing runs on this computer's server or in a call (update-when-quiet-main.mjs quietSignals),
 * and the screen is locked or nobody touched this mac or typed in the app for QUIET_IDLE_MS
 */
export async function quietNow(signals, now = Date.now()) {
  if (signals.busy?.()) return false;
  const away = signals.locked() || (signals.idleMs() >= QUIET_IDLE_MS && now - (signals.typedAt() ?? 0) >= QUIET_IDLE_MS);
  if (!away) return false;
  try { return (await signals.work()) === null; } catch { return false; }
}

/**
 * keeps the mac app current. `signed()`: whether this build can install updates (developerIdSigned); when it can't, or
 * anything on the way fails, `fallback.check()` (update-notice.mjs) tells the person instead. `onState({ ready })` says
 * a downloaded version waits for a restart; `available` names a newer version found, and `progress` (0 to 1) its download
 * while it runs.
 */
export function createAppUpdater({ current, arch, dir, fetchImpl = fetch, keys = RELEASE_KEYS, signed, installer, quiet, fallback, onState = () => {}, log = () => {}, firstDelayMs = 2 * 60_000, intervalMs = HOUR_MS, jitterMs = JITTER_MS, random = Math.random, quietEveryMs = 60_000, timers = globalThis }) {
  let ready = null, available = null, progress = null, timer = null, quietTimer = null, checking = null, installing = false;
  const state = () => ({ ready, available, progress });
  const tell = () => onState(state());

  async function text(url, limit) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const body = await response.text();
    if (body.length > limit) throw new Error(`${url} is too large`);
    return body;
  }

  async function download(url, file, sha256) {
    try { if (await hashOf(file) === sha256) return; } catch { /* not here yet */ }
    const part = `${file}.part`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`the update download answered ${response.status}`);
    // progress in whole percents, so the window hears at most a hundred changes
    const total = Number(response.headers.get("content-length")) || 0;
    let got = 0;
    const count = new Transform({ transform(chunk, _encoding, next) {
      got += chunk.length;
      const now = total ? Math.min(99, Math.floor((got * 100) / total)) / 100 : null;
      if (now !== null && now !== progress) { progress = now; tell(); }
      next(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), count, createWriteStream(part));
    if (await hashOf(part) !== sha256) { rmSync(part, { force: true }); throw new Error("the update did not match its checksum"); }
    renameSync(part, file);
  }

  async function run() {
    if (ready) return ready;
    if (!(await signed())) { await fallback.check(); return null; }
    const release = verifiedRelease(JSON.parse(await text(DESKTOP_MANIFEST_URL, 64 * 1024)), keys);
    if (!release) throw new Error("the release manifest is not signed by a pinned key");
    if (!newer(release.version, current)) return null;
    const sums = await text(sumsUrl(release.version), 64 * 1024);
    if (createHash("sha256").update(sums).digest("hex") !== release.sums) throw new Error("SHA256SUMS does not match the signed manifest");
    const zip = zipIn(sums, release.version, arch);
    if (!zip) throw new Error(`release ${release.version} has no zip for ${arch}`);
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) if (name !== zip.name && name !== `${zip.name}.part`) rmSync(join(dir, name), { recursive: true, force: true });
    const file = join(dir, zip.name);
    available = release.version; progress = 0; tell();
    try {
      await download(zipUrl(release.version, zip.name), file, zip.sha256);
      await installer.prepare(file, release.version);
    } finally { progress = null; }
    ready = release.version;
    log(`app update: ${ready} is ready; it installs on quit or at a quiet moment`);
    tell();
    watchQuiet();
    return ready;
  }

  function check() {
    checking ??= run().catch(async (error) => {
      if (available) tell();
      log(`app update: ${error instanceof Error ? error.message : String(error)}; telling the person instead`);
      await fallback.check();
      return null;
    }).finally(() => { checking = null; });
    return checking;
  }

  function watchQuiet() {
    if (quietTimer) return;
    const look = async () => {
      quietTimer = null;
      if (installing) return;
      if (await quiet().catch(() => false)) return restart();
      quietTimer = timers.setTimeout(look, quietEveryMs);
      quietTimer?.unref?.();
    };
    quietTimer = timers.setTimeout(look, quietEveryMs);
    quietTimer?.unref?.();
  }

  function restart() {
    if (!ready || installing) return false;
    installing = true;
    log(`app update: restarting into ${ready}`);
    installer.install();
    return true;
  }

  return {
    check, restart,
    state,
    start() {
      if (timer) return;
      const again = (delay) => { timer = timers.setTimeout(() => { void check().finally(() => again(intervalMs + Math.floor(random() * jitterMs))); }, delay); timer?.unref?.(); };
      again(firstDelayMs);
    },
    stop() { if (timer) timers.clearTimeout(timer); if (quietTimer) timers.clearTimeout(quietTimer); timer = quietTimer = null; },
  };
}

async function hashOf(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
