import assert from "node:assert/strict";
import test from "node:test";
import { accountSetupKey, accountSetupStore, localAccountSetupStore, remoteAccountSetupStore } from "./account-setup-store.mjs";
import { CLOUD_HOME_ID, installBotsElsewhere, ownBotCount, placesElsewhere, readBotCounts } from "./bots-elsewhere.mjs";

const memory = (value = null) => { let kept = value; return { read: () => { if (kept === null) throw new Error("ENOENT"); return structuredClone(kept); }, write: (next) => { kept = next; }, kept: () => kept }; };
const SERVER = { id: "srv", kind: "remote", name: "my-vps", origin: "http://vps.localhost:53713" };
const TEAM = { id: "team", kind: "remote", name: "Studio", origin: "https://studio.example.com", team: { id: "t1" } };
const HAND = { id: "hand", kind: "remote", name: "Lab box", origin: "http://lab.example.com:8799" };

test("the server the person moved to comes first, then a team's Cloud, then servers saved by hand", () => {
  assert.deepEqual(placesElsewhere({ environments: [HAND, TEAM, SERVER, { id: "local-2", kind: "local", name: "Work", dataDir: "/x" }], moved: { id: "srv", origin: SERVER.origin } }),
    [{ id: "srv", name: "my-vps", why: "moved" }, { id: "team", name: "Studio", why: "team" }, { id: "hand", name: "Lab box", why: "server" }]);
  assert.deepEqual(placesElsewhere({ environments: [] }), []);
  assert.deepEqual(placesElsewhere({ environments: [], cloudOrigin: "https://c.example.com" }), [{ id: CLOUD_HOME_ID, name: "My Cloud", why: "cloud" }]);
});

test("this computer's record keeps a hash of the account, never its id, and writes only on a change", async () => {
  const file = memory();
  const store = localAccountSetupStore(file);
  assert.equal(await store.read("acct_1"), null);
  assert.equal(await store.remember("acct_1", { kind: "server", name: "my-vps", at: 5 }), true);
  assert.equal(JSON.stringify(file.kept()).includes("acct_1"), false);
  assert.ok(file.kept().accounts[accountSetupKey("acct_1")]);
  assert.equal(await store.remember("acct_1", { kind: "server", name: "my-vps", at: 9 }), false);
  assert.deepEqual(await store.read("acct_1"), { kind: "server", name: "my-vps", at: 5 });
  assert.equal(await store.read("acct_2"), null);
  assert.equal(await store.remember("acct_1", { kind: "phone", name: "x" }), false);
});

test("the combined store reads here first, then the account's side, and keeps what that side knew", async () => {
  const local = localAccountSetupStore(memory());
  const remote = { read: async () => ({ kind: "cloud", name: "My Cloud", at: 1 }), remember: async () => true };
  const store = accountSetupStore({ local, remote });
  assert.deepEqual(await store.read("a"), { kind: "cloud", name: "My Cloud", at: 1 });
  assert.deepEqual(await local.read("a"), { kind: "cloud", name: "My Cloud", at: 1 });
  const broken = accountSetupStore({ local: localAccountSetupStore(memory()), remote: { read: async () => { throw new Error("down"); }, remember: async () => { throw new Error("down"); } } });
  assert.equal(await broken.read("a"), null);
  assert.equal(await broken.remember("a", { kind: "server", name: "x", at: 1 }), true);
  assert.equal(await remoteAccountSetupStore().read("a"), null);
});

function wire({ environments = [], account = { id: "acct" }, file = memory() } = {}) {
  const handlers = new Map(), opened = [], connected = [];
  const at = { environments, account };
  const store = accountSetupStore({ local: localAccountSetupStore(file), remote: remoteAccountSetupStore() });
  const installed = installBotsElsewhere({
    ipcMain: { handle: (channel, run) => handlers.set(channel, run) }, guard: (_channel, run) => run,
    places: () => placesElsewhere({ environments: at.environments }), account: () => at.account, store,
    open: (id) => opened.push(id), connectCloud: () => connected.push(true), now: () => 7,
  });
  return { at, handlers, opened, connected, installed, call: (channel, ...args) => handlers.get(channel)({}, ...args) };
}

test("with bots on a linked server, the page is told so and opens only a place main knows", async () => {
  const w = wire({ environments: [SERVER] });
  assert.deepEqual(await w.call("elsewhere:state"), { places: [{ id: "srv", name: "my-vps", why: "server" }], known: null });
  assert.equal(await w.call("elsewhere:open", "elsewhere"), false);
  assert.equal(await w.call("elsewhere:open", "srv"), true);
  assert.deepEqual(w.opened, ["srv"]);
});

test("a fresh install of a signed-in account that set up a server says so, and connect hands the page the Add VPS sheet", async () => {
  const file = memory();
  const before = wire({ environments: [SERVER], file });
  await before.installed.remember();
  const fresh = wire({ environments: [], file });
  assert.deepEqual(await fresh.call("elsewhere:state"), { places: [], known: { kind: "server", name: "my-vps" } });
  assert.equal(await fresh.call("elsewhere:connect"), "server");
  const signedOut = wire({ environments: [], file, account: null });
  assert.deepEqual(await signedOut.call("elsewhere:state"), { places: [], known: null });
  assert.equal(await signedOut.call("elsewhere:connect"), null);
});

test("a remembered Cloud connects from main's own session; a team's Cloud is not remembered", async () => {
  const file = memory();
  await wire({ environments: [TEAM], file }).installed.remember();
  assert.equal(file.kept(), null);
  await wire({ environments: [{ ...SERVER, cloud: { id: "c1" } }], file }).installed.remember();
  const fresh = wire({ environments: [], file });
  assert.equal(await fresh.call("elsewhere:connect"), "cloud");
  assert.equal(fresh.connected.length, 1);
});

test("open answers only once the switch is over, so the page never drops its screen before the window leaves", async () => {
  const handlers = new Map();
  let finish;
  installBotsElsewhere({
    ipcMain: { handle: (channel, run) => handlers.set(channel, run) }, guard: (_channel, run) => run,
    places: () => placesElsewhere({ environments: [SERVER] }), account: () => null, store: { read: async () => null, remember: async () => false },
    open: () => new Promise((resolve) => { finish = resolve; }), connectCloud: () => {},
  });
  let answered = false;
  const reply = handlers.get("elsewhere:open")({}, "srv").then((value) => { answered = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, false);
  finish();
  assert.equal(await reply, true);
});

test("a switch that throws answers false, so the page can say the place didn't open", async () => {
  const handlers = new Map(), lines = [];
  installBotsElsewhere({
    ipcMain: { handle: (channel, run) => handlers.set(channel, run) }, guard: (_channel, run) => run,
    places: () => placesElsewhere({ environments: [SERVER] }), account: () => null, store: { read: async () => null, remember: async () => false },
    open: async () => { throw new Error("unreachable"); }, connectCloud: () => {}, log: (line) => lines.push(line),
  });
  assert.equal(await handlers.get("elsewhere:open")({}, "srv"), false);
  assert.match(lines[0], /unreachable/);
});

test("a switch that says it didn't open answers false; any other answer means it went", async () => {
  const handlers = new Map();
  let said = false;
  installBotsElsewhere({
    ipcMain: { handle: (channel, run) => handlers.set(channel, run) }, guard: (_channel, run) => run,
    places: () => placesElsewhere({ environments: [SERVER] }), account: () => null, store: { read: async () => null, remember: async () => false },
    open: async () => said, connectCloud: () => {},
  });
  assert.equal(await handlers.get("elsewhere:open")({}, "srv"), false);
  said = undefined;
  assert.equal(await handlers.get("elsewhere:open")({}, "srv"), true);
});

test("bot counts come from each place's own list as the signed-in person; asleep or unreadable places get none", async () => {
  assert.equal(ownBotCount({ bots: [{ defaultBot: {} }, { hidden: true }, {}, {}] }), 2);
  assert.equal(ownBotCount({}), null);
  const asked = [];
  const answers = { "https://a.test": { ok: true, json: async () => ({ bots: [{}, {}, {}] }) }, "https://b.test": { ok: false, json: async () => ({}) } };
  const counts = await readBotCounts({
    places: [{ id: "a", origin: "https://a.test" }, { id: "b", origin: "https://b.test" }, { id: "c", origin: "https://c.test" }, { id: "z", origin: "https://z.test" }],
    fetch: async (url, init) => { asked.push([url, init.credentials]); const origin = new URL(url).origin; if (origin === "https://c.test") throw new Error("down"); return answers[origin]; },
    asleep: (origin) => origin === "https://z.test",
  });
  assert.deepEqual(counts, { a: 3 });
  assert.equal(asked.some(([url]) => url.startsWith("https://z.test")), false);
  assert.deepEqual(asked[0], ["https://a.test/api/bots?messages=0", "include"]);
});
