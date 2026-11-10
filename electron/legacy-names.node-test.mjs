import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  aliasLegacyEnv, aliasLegacyHeaders, carryLegacySafeStorageKey, dataDirFor, defaultCompanionDir, defaultDataDir, fromLegacyLink,
  fromLegacyPath, isOwnAppId, isOwnHeader, LEGACY, migrateLegacyDir, migrateLegacyStorage, migrateLegacyUserData, safeStorageItem,
  toLegacyPath, withLegacyHeaders,
} from "./legacy-names.mjs";

const OLD = LEGACY.devName;
const home = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omb-legacy-names-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test("old env names count as the new ones, and a new name already set wins", () => {
  const env = aliasLegacyEnv({ [`${LEGACY.envPrefixes[0]}DATA_DIR`]: "/old", [`${LEGACY.envPrefixes[1]}TOKEN`]: "t", [`${LEGACY.envPrefixes[0]}PORT`]: "1", DUSK_PORT: "2" });
  assert.equal(env.DUSK_DATA_DIR, "/old");
  assert.equal(env.DUSK_TOKEN, "t");
  assert.equal(env.DUSK_PORT, "2");
  assert.equal(env[`${LEGACY.envPrefixes[0]}DATA_DIR`], undefined, "moved, so no secret stays under a name the env filters miss");
  const lower = aliasLegacyEnv({ [`${LEGACY.envPrefixes[0].toLowerCase()}cloud_ready_token`]: "t" });
  assert.deepEqual(lower, { DUSK_cloud_ready_token: "t" }, "windows spells env names in any case");
});

test("an old data folder moves to the new name once, its bots readable by both paths", (t) => {
  const dir = home(t);
  const old = path.join(dir, LEGACY.dataDirName);
  write(path.join(old, "config.json"), "{}");
  write(path.join(old, "bots.json"), JSON.stringify([{ id: "b1", name: "Kept" }]));
  const lines = [];
  const used = defaultDataDir(dir, { log: (line) => lines.push(line) });
  assert.equal(used, path.join(dir, ".duskbot"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(used, "bots.json"), "utf8"))[0].name, "Kept");
  assert.ok(fs.lstatSync(old).isSymbolicLink());
  assert.equal(JSON.parse(fs.readFileSync(path.join(old, "bots.json"), "utf8"))[0].name, "Kept", "absolute paths saved inside still resolve");
  assert.equal(defaultDataDir(dir), used, "a second start changes nothing");
  assert.equal(lines.length, 1);
});

test("a new folder that already holds data wins, and the old one is left as it was", (t) => {
  const dir = home(t);
  write(path.join(dir, LEGACY.dataDirName, "config.json"), "old");
  write(path.join(dir, ".duskbot", "config.json"), "new");
  assert.equal(defaultDataDir(dir), path.join(dir, ".duskbot"));
  assert.equal(fs.readFileSync(path.join(dir, LEGACY.dataDirName, "config.json"), "utf8"), "old");
  assert.ok(!fs.lstatSync(path.join(dir, LEGACY.dataDirName)).isSymbolicLink());
});

test("a new folder holding only what was written before the move (no config, bots or messages) is set aside, never deleted", (t) => {
  const dir = home(t);
  write(path.join(dir, LEGACY.dataDirName, "config.json"), "old");
  write(path.join(dir, ".duskbot", "logs", "early.log"), "early");
  const used = defaultDataDir(dir, { now: () => 7 });
  assert.equal(fs.readFileSync(path.join(used, "config.json"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(dir, ".duskbot.before-move-7", "logs", "early.log"), "utf8"), "early");
  const other = home(t);
  write(path.join(other, LEGACY.dataDirName, "bots.json"), "[]");
  write(path.join(other, ".duskbot", "logs", "early.log"), "early");
  assert.equal(fs.readFileSync(path.join(defaultDataDir(other, { now: () => 8 }), "bots.json"), "utf8"), "[]", "an install that never saved settings");
});

test("a move that fails keeps using the old folder where it is", (t) => {
  const dir = home(t);
  const old = path.join(dir, LEGACY.dataDirName);
  write(path.join(old, "config.json"), "{}");
  const refusing = { ...fs, renameSync: () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); } };
  assert.equal(migrateLegacyDir(path.join(dir, ".duskbot"), old, { fs: refusing }), old);
  assert.ok(fs.existsSync(path.join(old, "config.json")));
});

test("a data folder setting naming the default moves the old folder too; any other is used as it is", (t) => {
  const dir = home(t);
  write(path.join(dir, LEGACY.dataDirName, "config.json"), "{}");
  assert.equal(dataDirFor("/somewhere/else", dir), "/somewhere/else");
  assert.ok(!fs.existsSync(path.join(dir, ".duskbot")));
  assert.equal(dataDirFor(path.join(dir, ".duskbot"), dir), path.join(dir, ".duskbot"));
  assert.ok(fs.existsSync(path.join(dir, ".duskbot", "config.json")));
});

test("the companion's folder moves the same way", (t) => {
  const dir = home(t);
  write(path.join(dir, LEGACY.companionDirName, "devices.json"), "[]");
  assert.equal(fs.readFileSync(path.join(defaultCompanionDir(dir), "devices.json"), "utf8"), "[]");
});

test("electron's own folder is copied, not moved, without chromium's locks", (t) => {
  const appData = home(t);
  const old = path.join(appData, LEGACY.product);
  write(path.join(old, "credentials.bin"), "sealed");
  write(path.join(old, "Local Storage", "leveldb", "000001.log"), "prefs");
  write(path.join(old, "SingletonLock"), "x");
  const next = path.join(appData, "Dusk Bot");
  assert.equal(migrateLegacyUserData(next, appData), true);
  assert.equal(fs.readFileSync(path.join(next, "credentials.bin"), "utf8"), "sealed");
  assert.equal(fs.readFileSync(path.join(next, "Local Storage", "leveldb", "000001.log"), "utf8"), "prefs");
  assert.ok(!fs.existsSync(path.join(next, "SingletonLock")));
  assert.equal(fs.readFileSync(path.join(old, "credentials.bin"), "utf8"), "sealed", "an older build started again finds its own");
  assert.equal(migrateLegacyUserData(next, appData), false, "once");
  const dev = home(t);
  write(path.join(dev, OLD, "window-state.json"), "{}");
  assert.equal(migrateLegacyUserData(path.join(dev, "duskbot"), dev, { packaged: false }), true);
});

test("the keychain key is copied under the new app name through stdin, only when the new one is missing", () => {
  const items = new Map([[`${LEGACY.product} Safe Storage|${LEGACY.product} Key`, "s3cret\"key"]]);
  const calls = [];
  const run = (args, input) => {
    calls.push({ args, input });
    if (args[0] === "-i") {
      const [, service, account, secret] = /-s "(.*)" -a "(.*)" -w "(.*)"\n$/.exec(input);
      items.set(`${service}|${account}`, secret.replace(/\\(.)/g, "$1"));
      return { status: 0 };
    }
    const key = `${args[2]}|${args[4]}`;
    return items.has(key) ? { status: 0, stdout: args.includes("-w") ? `${items.get(key)}\n` : "" } : { status: 44 };
  };
  assert.equal(carryLegacySafeStorageKey({ name: "Dusk Bot", run }), "copied");
  const next = safeStorageItem("Dusk Bot");
  assert.equal(items.get(`${next.service}|${next.account}`), "s3cret\"key");
  assert.ok(calls.every((call) => !call.args.some((arg) => arg.includes("s3cret"))), "never in a process list");
  assert.equal(carryLegacySafeStorageKey({ name: "Dusk Bot", run }), "present");
  assert.equal(carryLegacySafeStorageKey({ name: "duskbot", packaged: false, run: () => ({ status: 44 }) }), "none");
});

test("links with the old scheme open like new ones", () => {
  assert.equal(fromLegacyLink(`${OLD}://thread/t1?bot=b1`), "duskbot://thread/t1?bot=b1");
  assert.equal(fromLegacyLink(`${OLD.toUpperCase()}://cloud`), "duskbot://cloud");
  assert.equal(fromLegacyLink("duskbot://bot/b1"), "duskbot://bot/b1");
  assert.equal(fromLegacyLink("https://example.test/"), "https://example.test/");
});

test("old header names read as new ones; a proxy strips both; an old peer gets both", () => {
  const headers = aliasLegacyHeaders({ [`${LEGACY.headerPrefix}companion`]: "1", [`${LEGACY.headerPrefix}cli`]: "old", "x-dusk-cli": "new" });
  assert.deepEqual(headers, { "x-dusk-companion": "1", "x-dusk-cli": "new" });
  assert.ok(isOwnHeader(`${LEGACY.headerPrefix}desktop-owner`) && isOwnHeader("X-Dusk-Desktop-Owner") && !isOwnHeader("x-other"));
  assert.deepEqual(withLegacyHeaders({ "x-dusk-cli": "1", accept: "a" }), { "x-dusk-cli": "1", accept: "a", [`${LEGACY.headerPrefix}cli`]: "1" });
});

test("the old well-known path answers as the new one, and a server id under either name is ours", () => {
  assert.equal(fromLegacyPath(`${LEGACY.wellKnown}/environment`), "/.well-known/duskbot/environment");
  assert.equal(fromLegacyPath("/api/bots"), "/api/bots");
  assert.equal(toLegacyPath("/.well-known/duskbot/environment"), `${LEGACY.wellKnown}/environment`);
  assert.ok(isOwnAppId("duskbot") && isOwnAppId(LEGACY.appId) && !isOwnAppId("other"));
});

test("preferences saved under the old prefix carry over once; the new value wins", () => {
  const data = new Map([[`${LEGACY.storagePrefixes[0]}sidebarDensity`, "compact"], [`${LEGACY.storagePrefixes[0]}botPanelOpen.v1`, "1"], ["duskbot.botPanelOpen.v1", "0"], ["omb-skin", "dusk"]]);
  const storage = { get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(migrateLegacyStorage(storage), 1);
  assert.equal(data.get("duskbot.sidebarDensity"), "compact");
  assert.equal(data.get("duskbot.botPanelOpen.v1"), "0");
  assert.equal(migrateLegacyStorage(storage), 0);
});
