import assert from "node:assert/strict";
import test from "node:test";

import { createVpsLink } from "./vps-link.mjs";

const until = async (check, ms = 2_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 5))) if (check()) return;
  assert.fail("timed out");
};

test("the move screen hears a failed copy in plain words with its next try, and Try now asks the move to go again", async () => {
  let value = { v: 1, current: "aaaaaaaaaa", links: [{ id: "aaaaaaaaaa", name: "Oracle", mode: "direct", origin: "https://203-0-113-5.sslip.io", envId: "env-9", keyP: "p:key", tokenP: "p:token" }],
    move: { linkId: "aaaaaaaaaa", step: "copy", status: "running", startedAt: 1 } };
  let trouble = { error: "fetch failed", retryAt: 1_700_000_222_000 };
  const retried = [];
  const ownHome = {
    start: async () => {}, view: () => ({ phase: "copy", chats: { done: 18, total: 18 } }), away: () => false, home: () => null, chosen: () => null,
    trouble: () => trouble, retry: async () => { retried.push(1); trouble = null; },
  };
  const link = createVpsLink({
    base: "https://link.example.test", fetch: async () => assert.fail("no link service"), serverFetch: async () => new Response("{}"),
    store: { read: () => value, write: (next) => { value = next; } }, protect: async (text) => `p:${text}`, unprotect: async (text) => text.slice(2), label: () => "Mac",
    saveServer: () => "env-9", forgetServer: () => {}, switchTo: () => {}, ownHome, ownHomeReset: () => {}, localRequest: async () => new Response("{}"),
    backups: { save: async () => ({ file: "", bytes: 0 }), open: async () => assert.fail("no backup") },
    localCredentials: { codexAuth: async () => null, claudeCli: async () => null, claudeToken: async () => "" },
    relaunch: () => {}, pollMs: 5, proxyFactory: () => ({ start: async () => "http://vps-aaaaaaaaaa.localhost:1", control: async () => ({}), close: async () => {} }),
  });
  await link.resume();
  await until(() => link.view().move?.retryAt);
  assert.deepEqual(link.view().move, { step: "copy", status: "running", chats: { done: 18, total: 18 }, error: "Your server didn't answer.", retryAt: 1_700_000_222_000 });

  trouble = { error: "Oracle isn't answering yet.", retryAt: 1_700_000_252_000 };
  await until(() => link.view().move?.retryAt === 1_700_000_252_000);
  assert.equal(link.view().move.error, "Oracle isn't answering yet.", "a plain sentence is shown as it is");

  const after = link.retryMove();
  assert.equal(after.move.retryAt, undefined, "no countdown once it goes again");
  assert.deepEqual(retried, [1]);
  await until(() => !link.view().move?.error);
  assert.equal(link.view().move.status, "running");
  await link.close();
});
