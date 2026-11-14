import assert from "node:assert/strict";
import test from "node:test";
import { cleanAccountIntent } from "./cloud-account.mjs";

test("a sign-in from linking a server keeps its source, so the website can say it is linking; other sources stay out", () => {
  assert.deepEqual(cleanAccountIntent({ kind: "signin", source: "server_link" }), { kind: "signin", source: "server_link" });
  assert.deepEqual(cleanAccountIntent({ kind: "signin", source: "made_up" }), { kind: "signin" });
  assert.deepEqual(cleanAccountIntent({ kind: "upgrade", plan: "plus", source: "server_link" }), { kind: "upgrade", plan: "plus" });
});
