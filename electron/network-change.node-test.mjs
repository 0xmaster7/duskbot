// a changed set of addresses (another network) says so once it settles; link-local and loopback churn says nothing
import assert from "node:assert/strict";
import test from "node:test";

import { addressPrint, watchNetwork } from "./network-change.mjs";

test("the print keeps real addresses only", () => {
  const print = addressPrint({ lo0: [{ address: "127.0.0.1", internal: true }], en0: [{ address: "192.168.1.4", internal: false }, { address: "fe80::1", internal: false }] });
  assert.equal(print, "en0|192.168.1.4");
});

test("a switch is reported once, after it settled", async () => {
  let current = "en0|192.168.1.4", calls = 0;
  const stop = watchNetwork(() => { calls += 1; }, { everyMs: 10, read: () => current });
  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(calls, 0);
    current = "en0|172.20.10.3";
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls, 1);
  } finally { stop(); }
});
