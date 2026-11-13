// The app's link proxy answers the direct screen's TURN servers itself: they come from the signed-in account in the
// app, never from the linked server, and the request never reaches the relay.
import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { createTunnelProxy, SCREEN_ICE_PATH } from "./vps-link-protocol.mjs";

const options = { base: "https://relay.test", id: "abcdefghijklmnopqrstuvwx", key: Buffer.alloc(32, 7).toString("base64url"), token: "t", log: () => {} };
const turn = [{ urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" }];

function get(origin, path, host = origin.host) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: origin.port, path, headers: { host } }, (res) => {
      let text = "";
      res.on("data", (chunk) => text += chunk);
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("answers the screen's TURN servers locally, without the relay", { timeout: 3000 }, async () => {
  const sent = [];
  const proxy = createTunnelProxy({ ...options, screenIce: async () => turn, fetch: (url, init) => {
    if (String(url).includes("/to-vps")) sent.push(url);
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  const origin = new URL(await proxy.start());
  assert.deepEqual(await get(origin, SCREEN_ICE_PATH), { status: 200, text: JSON.stringify({ iceServers: turn, link: "relay" }) });
  assert.equal((await get(origin, SCREEN_ICE_PATH, "evil.example")).status, 421);
  assert.deepEqual(sent, []);
  await proxy.close();
});

test("answers no TURN servers when the account has none or fails", { timeout: 3000 }, async () => {
  for (const screenIce of [undefined, async () => null, async () => { throw new Error("signed out"); }]) {
    const proxy = createTunnelProxy({ ...options, screenIce, fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })) });
    const origin = new URL(await proxy.start());
    assert.deepEqual(await get(origin, SCREEN_ICE_PATH), { status: 200, text: JSON.stringify({ iceServers: [], link: "relay" }) });
    await proxy.close();
  }
});
