import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";

import { WAKE_INTENTS, createCloudAccountClient } from "./cloud-account.mjs";

// wakeHome names what the person did: only a key press, a click or a send wakes a sleeping Cloud; opening and viewing
// leave it asleep (the Admin's answer), against a fake Admin.
const accessToken = `omc_${"T".repeat(43)}`;
const NOW = 1_800_000_000_000;
const paid = { plan: "pro", tier: "pro", status: "active", expiresAt: NOW + 30 * 86400_000, version: 1 };

async function admin(t) {
  const f = { requests: [], power: { state: "asleep", since: NOW - 60_000, sleeps: true } };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : undefined;
    f.requests.push({ route: req.url, method: req.method, body: data });
    const send = (status, out) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(out)); };
    if (req.headers.authorization !== `Bearer ${accessToken}`) return send(401, { error: "invalid_token" });
    if (req.url === "/api/cloud/desktop/session") return send(200, { cloudContractVersion: 1, expiresAt: NOW + 86400_000, device: { id: "device-1" },
      account: { id: "acct-1", email: "person@example.test" }, entitlement: paid, cloud: { state: "ready", origin: "https://d0123456789abcdef0123.desktops.example.test", pairingAvailable: true, power: f.power } });
    if (req.url === "/api/cloud/desktop/wake" && req.method === "POST") {
      if (["open", "view"].includes(data?.intent)) return send(200, { cloudContractVersion: 1, state: "asleep", wakesOn: "intent" });
      f.power = { state: "waking", since: NOW, sleeps: true };
      return send(200, { cloudContractVersion: 1, state: "waking" });
    }
    send(404, { error: "not_found" });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const saved = { origin, token: accessToken, expiresAt: NOW + 86400_000, device: { id: "device-1" }, account: { id: "acct-1", email: "person@example.test" } };
  f.client = createCloudAccountClient({ origin, fixture: true, deviceName: "Fixture computer", platform: "darwin", appVersion: "0.1.fixture", now: () => NOW,
    store: { read: async () => saved, write: async () => {} }, openBrowser: async () => {}, setTimer: () => 1, clearTimer: () => {} });
  t.after(async () => { f.client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return f;
}

const wakes = f => f.requests.filter(request => request.route === "/api/cloud/desktop/wake").map(request => request.body);

test("opening or viewing sends its intent and leaves the Cloud asleep; typing wakes it", async t => {
  const f = await admin(t);
  await f.client.start();
  assert.equal(await f.client.wakeHome("open"), "asleep");
  assert.equal(await f.client.wakeHome("view"), "asleep");
  assert.equal(f.client.power().state, "asleep");
  assert.equal(await f.client.wakeHome("type"), "waking");
  assert.deepEqual(wakes(f), [{ intent: "open" }, { intent: "view" }, { intent: "type" }]);
  assert.equal(f.client.power().state, "waking");
});

test("a wake never goes without an intent the Admin knows", async t => {
  const f = await admin(t);
  await f.client.start();
  assert.deepEqual([...WAKE_INTENTS], ["type", "click", "send", "open", "view"]);
  for (const bad of [undefined, "", "hover", "connector"]) await assert.rejects(f.client.wakeHome(bad), /Invalid wake intent/);
  assert.deepEqual(wakes(f), []);
});
