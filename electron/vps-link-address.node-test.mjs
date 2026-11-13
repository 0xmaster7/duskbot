// a server linked at an https address of its own (tailscale, cloudflare, a domain): when the address stops answering the
// app asks the agent where it is now (a quick tunnel's new name), else goes through the relay until the address is back
import assert from "node:assert/strict";
import test from "node:test";

import { createVpsLink } from "./vps-link.mjs";

const until = async (check, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const RELAY = "http://vps-cccccccccc.localhost:5555";
function make({ origin, address }) {
  let value = { v: 1, current: "cccccccccc", links: [{ id: "cccccccccc", base: "http://relay.invalid", name: "box", mode: "direct", via: "cloudflare", origin, spki: null, envId: "env-1", keyP: "p:k", tokenP: "p:t" }] };
  const up = new Set([origin]);
  const retargeted = [], signedIn = [];
  const said = { address };
  const link = createVpsLink({
    base: "http://relay.invalid", addressCheckMs: 20,
    serverFetch: async (url, init = {}) => {
      const { origin: at, pathname } = new URL(url);
      if (at !== RELAY && !up.has(at)) throw new Error("fetch failed");
      if (pathname === "/api/health") return new Response("{}", { status: 200 });
      if (pathname === "/api/auth/session") return new Response(JSON.stringify({ kind: signedIn.includes(at) ? "session" : "none" }));
      if (pathname === "/api/auth/pair") { assert.equal(JSON.parse(init.body).code, "PAIR-CODE"); signedIn.push(at); return new Response(JSON.stringify({ session: {} })); }
      return new Response("{}", { status: 404 });
    },
    store: { read: () => value, write: (next) => { value = JSON.parse(JSON.stringify(next)); } }, protect: async (text) => `p:${text}`, unprotect: async (text) => text.slice(2), label: () => "Mac",
    saveServer: () => "env-1", forgetServer: () => {}, switchTo: () => {}, retarget: (from, to) => retargeted.push([from, to]), pin: () => {},
    ownHome: { away: () => false, view: () => null, home: () => null, chosen: () => null, start: async () => {} },
    ownHomeReset: () => {}, localRequest: async () => new Response("{}"), backups: { save: async () => ({}), open: async () => ({}) },
    localCredentials: { codexAuth: async () => null, claudeCli: async () => null, claudeToken: async () => "" }, relaunch: () => {},
    proxyFactory: () => ({ start: async () => RELAY, close: async () => {}, transport: () => "relay",
      control: async (op) => { if (op === "hello") return { protocol: 2, agent: "2.0.0", caps: [], address: said.address }; if (op === "pair") return { code: "PAIR-CODE" }; throw new Error("unknown request"); } }),
  });
  return { link, up, retargeted, signedIn, said, stored: () => value.links[0] };
}

test("an address that stops answering hands the window to the relay, and gets it back once it answers", async () => {
  const CF = "https://old-name.trycloudflare.com";
  const box = make({ origin: CF, address: { mode: "direct", via: "cloudflare", origin: CF, spki: null } });
  try {
    await box.link.resume();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(box.link.view().server.origin, CF, "an address that answers is kept");
    box.up.delete(CF);
    await until(() => box.link.view().server.origin === RELAY);
    assert.deepEqual(box.link.view(), { ...box.link.view(), mode: "relay", via: "relay" });
    assert.deepEqual(box.stored().away, { via: "cloudflare", origin: CF, spki: null });
    assert.deepEqual(box.retargeted, [[CF, RELAY]]);
    await until(() => box.signedIn.includes(RELAY));
    box.up.add(CF);
    await until(() => box.link.view().server.origin === CF);
    assert.equal(box.link.view().via, "cloudflare");
    assert.equal(box.stored().away, undefined);
    assert.deepEqual(box.retargeted, [[CF, RELAY], [RELAY, CF]]);
  } finally { await box.link.close(); }
});

test("a quick tunnel's new name is followed while the app runs, with no stop at the relay", async () => {
  const OLD = "https://old-name.trycloudflare.com", NEW = "https://new-name.trycloudflare.com";
  const box = make({ origin: OLD, address: { mode: "direct", via: "cloudflare", origin: OLD, spki: null } });
  try {
    await box.link.resume();
    // cloudflared restarted: a new name, the old one gone
    box.up.delete(OLD);
    box.up.add(NEW);
    box.said.address = { mode: "direct", via: "cloudflare", origin: NEW, spki: null };
    await until(() => box.link.view().server.origin === NEW);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(box.link.view().server.origin, NEW);
    assert.deepEqual(box.retargeted, [[OLD, NEW]]);
    assert.ok(!box.retargeted.some(([, to]) => to === RELAY));
  } finally { await box.link.close(); }
});

test("on the relay, a quick tunnel that comes back under a new name is followed there", async () => {
  const OLD = "https://old-name.trycloudflare.com", NEW = "https://new-name.trycloudflare.com";
  const box = make({ origin: OLD, address: { mode: "direct", via: "cloudflare", origin: OLD, spki: null } });
  try {
    await box.link.resume();
    box.up.delete(OLD);
    await until(() => box.link.view().server.origin === RELAY);
    box.up.add(NEW);
    box.said.address = { mode: "direct", via: "cloudflare", origin: NEW, spki: null };
    await until(() => box.link.view().server.origin === NEW);
    assert.equal(box.stored().away, undefined);
    assert.deepEqual(box.retargeted, [[OLD, RELAY], [RELAY, NEW]]);
  } finally { await box.link.close(); }
});
