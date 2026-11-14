import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { bringSignInsHome, parseListing, syncConnectors, TOPUP_MS } from "./connector-sync.mjs";

const NOW = 1_800_000_000_000;
const URL_A = "https://mcp.notion.example/mcp", URL_B = "https://connect.composio.example/mcp";
const digest = (access) => createHash("sha256").update(`omb-connector:${access}`).digest("hex");

/** One place as server/connector-sync.ts answers it, in memory: its servers, sign-ins and times, every call recorded. */
function place(kind, label, { servers = {}, removed = {}, signedOut = {}, refreshEvery = false } = {}) {
  const calls = [];
  const state = { servers: structuredClone(servers), removed: { ...removed }, signedOut: { ...signedOut } };
  let minted = 0;
  const signIn = (server) => {
    const s = server.signIn;
    if (!s || s.role === "none" || s.role === "needs-sign-in") return { role: s?.role ?? "none" };
    return { role: s.role, digest: digest(s.access), ...(s.expiresAt ? { expiresAt: s.expiresAt } : {}), signedInAt: s.signedInAt };
  };
  const client = {
    list: async () => parseListing({ place: { id: label, label }, servers: Object.entries(state.servers).map(([name, server]) => ({ name, url: server.url, enabled: true, addedAt: server.addedAt, signIn: signIn(server) })), removed: state.removed, signedOut: state.signedOut }),
    definition: async (name) => { calls.push(["definition", name]); return { server: { type: "http", url: state.servers[name].url, headers: { Authorization: "Bearer k" }, enabled: true }, addedAt: state.servers[name].addedAt }; },
    put: async (name, server, addedAt) => { calls.push(["put", name]); state.servers[name] = { url: server.url, addedAt, signIn: { role: "none" } }; return {}; },
    remove: async (name, at) => { calls.push(["remove", name]); state.removed[state.servers[name].url] = at; delete state.servers[name]; return {}; },
    signOut: async (name, at) => { calls.push(["signOut", name]); state.signedOut[state.servers[name].url] = at; state.servers[name].signIn = { role: "none" }; return {}; },
    lend: async (name) => {
      calls.push(["lend", name]);
      const s = state.servers[name].signIn;
      if (refreshEvery) { s.access = `${label}-fresh-${++minted}`; s.expiresAt = NOW + 60 * 60_000; }
      return { access: s.access, expiresAt: s.expiresAt, grantAt: s.signedInAt };
    },
    borrow: async (name, lent) => { calls.push(["borrow", name]); state.servers[name].signIn = { role: "lent", access: lent.access, expiresAt: lent.expiresAt, signedInAt: lent.grantAt }; return { borrowed: true }; },
    take: async (name) => { calls.push(["take", name]); const s = state.servers[name].signIn; return { record: { url: state.servers[name].url, state: "signed-in", tokens: { access: s.access, refresh: s.refresh } }, digest: digest(s.refresh), signedInAt: s.signedInAt }; },
    adopt: async (name, taken) => { calls.push(["adopt", name]); state.servers[name].signIn = { role: "holder", access: taken.record.tokens.access, refresh: taken.record.tokens.refresh, signedInAt: taken.signedInAt }; return { adopted: true }; },
    release: async (name) => { calls.push(["release", name]); const s = state.servers[name].signIn; state.servers[name].signIn = { role: "lent", access: s.access, signedInAt: s.signedInAt }; return { released: true }; },
  };
  return { key: `${kind}:${label}`, kind, label, client, calls, state };
}
const holder = (access, signedInAt, expiresAt = NOW + 60 * 60_000) => ({ role: "holder", access, refresh: `r-${access}`, signedInAt, expiresAt });
const run = (places) => syncConnectors(places, { now: () => NOW });

test("a server signed in on this computer arrives on My Cloud, which holds it, and this computer borrows", async () => {
  const mac = place("local", "This computer", { servers: { notion: { url: URL_A, addedAt: 10, signIn: holder("a1", 20) } } });
  const cloud = place("cloud", "My Cloud");
  const done = await run([mac, cloud]);
  assert.deepEqual(done.failed, []);
  assert.deepEqual(done.added, [{ name: "notion", place: "My Cloud" }]);
  assert.deepEqual(done.moved, [{ name: "notion", from: "This computer", to: "My Cloud" }]);
  assert.equal(cloud.state.servers.notion.signIn.role, "holder");
  assert.equal(cloud.state.servers.notion.signIn.refresh, "r-a1");
  assert.equal(mac.state.servers.notion.signIn.role, "lent");
  assert.equal(mac.state.servers.notion.signIn.refresh, undefined);
  // level now: another pass changes nothing
  const again = await run([mac, cloud]);
  assert.deepEqual([again.added, again.moved, again.lent, again.failed], [[], [], [], []]);
});

test("a Cloud whose plan sleeps borrows from this computer rather than holding: nothing here wakes it", async () => {
  const mac = place("local", "This computer", { servers: { notion: { url: URL_A, addedAt: 10, signIn: holder("a1", 20) } } });
  const cloud = place("sleeping-cloud", "My Cloud");
  const done = await run([mac, cloud]);
  assert.deepEqual(done.moved, []);
  assert.equal(mac.state.servers.notion.signIn.role, "holder");
  assert.equal(cloud.state.servers.notion.signIn.role, "lent");
});

test("a lent token near its end is topped up from the holder; one with time left is not", async () => {
  const cloud = place("cloud", "My Cloud", { refreshEvery: true, servers: { notion: { url: URL_A, addedAt: 10, signIn: holder("c1", 20) } } });
  const mac = place("local", "This computer", { servers: { notion: { url: URL_A, addedAt: 10, signIn: { role: "lent", access: "c1", signedInAt: 20, expiresAt: NOW + TOPUP_MS + 60_000 } } } });
  assert.deepEqual((await run([mac, cloud])).lent, []);
  mac.state.servers.notion.signIn.expiresAt = NOW + TOPUP_MS - 1;
  assert.deepEqual((await run([mac, cloud])).lent, [{ name: "notion", place: "This computer" }]);
  assert.equal(mac.state.servers.notion.signIn.access, cloud.state.servers.notion.signIn.access);
  assert.equal(mac.calls.some(([op]) => op === "lend" || op === "take"), false, "this computer never refreshes it");
});

test("a sign-out anywhere ends every sign-in made before it, and a later sign-in wins over it", async () => {
  const cloud = place("cloud", "My Cloud", { servers: { notion: { url: URL_A, addedAt: 10, signIn: { role: "none" } } }, signedOut: { [URL_A]: 50 } });
  const mac = place("local", "This computer", { servers: { notion: { url: URL_A, addedAt: 10, signIn: { role: "lent", access: "c1", signedInAt: 20 } } } });
  const server = place("server", "Studio VPS", { servers: { notion: { url: URL_A, addedAt: 10, signIn: holder("v1", 60) } } });
  const done = await run([mac, cloud, server]);
  assert.deepEqual(done.signedOut, [{ name: "notion", place: "This computer" }]);
  // the VPS signed in after the sign-out: it stays, and lends to the others (My Cloud holds it from now on)
  assert.equal(cloud.state.servers.notion.signIn.role, "holder");
  assert.equal(mac.state.servers.notion.signIn.role, "lent");
  assert.equal(server.state.servers.notion.signIn.role, "lent");
});

test("a removal wins over an older add, and a newer add wins over an older removal", async () => {
  const mac = place("local", "This computer", { servers: { notion: { url: URL_A, addedAt: 10, signIn: { role: "none" } } } });
  const cloud = place("cloud", "My Cloud", { removed: { [URL_A]: 30 } });
  assert.deepEqual((await run([mac, cloud])).removed, [{ name: "notion", place: "This computer" }]);
  assert.deepEqual(mac.state.servers, {});

  const mac2 = place("local", "This computer", { servers: { notion: { url: URL_A, addedAt: 40, signIn: { role: "none" } } } });
  const cloud2 = place("cloud", "My Cloud", { removed: { [URL_A]: 30 } });
  assert.deepEqual((await run([mac2, cloud2])).added, [{ name: "notion", place: "My Cloud" }]);
});

test("a name another server holds is never overwritten, and places with their own sign-ins keep them", async () => {
  const mac = place("local", "This computer", { servers: { apps: { url: URL_B, addedAt: 10, signIn: holder("m1", 20) } } });
  const cloud = place("cloud", "My Cloud", { servers: { apps: { url: URL_A, addedAt: 5, signIn: { role: "none" } } } });
  const done = await run([mac, cloud]);
  assert.ok(done.failed.some((line) => /another server has this name/u.test(line)));
  assert.equal(cloud.state.servers.apps.url, URL_A);

  const both = [place("local", "This computer", { servers: { c: { url: URL_B, addedAt: 1, signIn: holder("m1", 20) } } }),
    place("cloud", "My Cloud", { servers: { c: { url: URL_B, addedAt: 1, signIn: holder("k1", 10) } } })];
  const level = await run(both);
  assert.deepEqual([level.moved, level.lent], [[], []]);
  assert.equal(both[0].state.servers.c.signIn.access, "m1");
});

test("one place alone has nothing to bring level, and one that does not answer is left out", async () => {
  const mac = place("local", "This computer", { servers: { notion: { url: URL_A, addedAt: 10, signIn: holder("a1", 20) } } });
  assert.deepEqual(await run([mac]), { added: [], removed: [], signedOut: [], moved: [], lent: [], failed: [] });
  const gone = { key: "cloud", kind: "cloud", label: "My Cloud", client: { list: async () => { throw new Error("asleep"); } } };
  assert.deepEqual((await run([mac, gone])).failed, []);
  assert.deepEqual(mac.calls, []);
});

test("coming home from a Cloud that ended brings its sign-ins, with servers this computer lacks", async () => {
  const cloud = place("cloud", "My Cloud", { servers: { notion: { url: URL_A, addedAt: 10, signIn: holder("c1", 20) } } });
  const mac = place("local", "This computer");
  assert.deepEqual(await bringSignInsHome(cloud.client, mac.client), ["notion"]);
  assert.equal(mac.state.servers.notion.signIn.role, "holder");
  assert.equal(mac.state.servers.notion.signIn.refresh, "r-c1");
  assert.equal(cloud.state.servers.notion.signIn.role, "lent");
});
