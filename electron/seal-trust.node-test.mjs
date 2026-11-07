import assert from "node:assert/strict";
import test from "node:test";

import { sealTrustAnswer } from "./seal-trust.mjs";

const ID = `${"a".repeat(43)}.${"b".repeat(43)}`;
const asked = [];
const deps = (over = {}) => ({
  isLocal: () => false,
  pageOrigin: () => "http://vps-abc.localhost:5300",
  links: () => ({ sealTrust: (origin, identity) => { asked.push([origin, identity]); return { ok: identity === ID, pinned: true }; } }),
  ...over,
});

test("this computer's own page needs no pin", () => {
  assert.deepEqual(sealTrustAnswer({}, ID, deps({ isLocal: () => true })), { ok: true, pinned: false });
});

test("a linked server's page is checked for the server main names, never one the page names", () => {
  asked.length = 0;
  assert.deepEqual(sealTrustAnswer({}, ID, deps()), { ok: true, pinned: true });
  assert.deepEqual(sealTrustAnswer({}, `${"c".repeat(43)}.${"d".repeat(43)}`, deps()), { ok: false, pinned: true });
  assert.deepEqual(asked.map(([origin]) => origin), ["http://vps-abc.localhost:5300", "http://vps-abc.localhost:5300"]);
});

test("a page that is not this window's active server, or a malformed identity, is refused", () => {
  assert.deepEqual(sealTrustAnswer({}, ID, deps({ pageOrigin: () => null })), { ok: false, pinned: false });
  assert.deepEqual(sealTrustAnswer({}, "x.y", deps({ isLocal: () => true })), { ok: false, pinned: false });
});

test("a server this app did not link has nothing to pin against", () => {
  assert.deepEqual(sealTrustAnswer({}, ID, deps({ links: () => ({ sealTrust: () => null }) })), { ok: true, pinned: false });
});
