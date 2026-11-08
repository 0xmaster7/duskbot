import assert from "node:assert/strict";
import test from "node:test";
import { createAccountEnroll } from "./account-enroll.mjs";

const grant = { enrollToken: "e".repeat(43), dashboardUrl: "https://accounts.test" };
const connected = id => ({ status: "connected", account: { id, email: `${id}@test.example` } });
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const f = { memory: null, grants: 0, requests: [], writes: [], logs: [], timers: new Map(), delays: [], status: 200, answer: { claimed: true, workspaceId: "workspace" } };
  let nextTimer = 0;
  f.enroll = createAccountEnroll({ client: () => ({ enrollGrant: async () => { f.grants++; return grant; } }),
    localRequest: async (...args) => { f.requests.push(args); return { status: f.status, json: async () => f.answer }; },
    readMemory: () => f.memory, writeMemory: value => { f.memory = value; f.writes.push(value); }, log: line => f.logs.push(line),
    setTimer: (callback, delay) => { f.delays.push(delay); f.timers.set(++nextTimer, callback); return nextTimer; }, clearTimer: id => f.timers.delete(id), ...options });
  f.tick = async () => { assert.equal(f.timers.size, 1); const [id, callback] = f.timers.entries().next().value; f.timers.delete(id); callback(); await settle(); };
  return f;
}

test("enrolls once per remembered account, fire and forget, with a bounded local request", async () => {
  const f = fixture();
  for (const state of [null, { status: "signed-out" }, { status: "connecting" }, { status: "connected" }, { ...connected("a"), status: "unavailable" }]) f.enroll.onState(state);
  await settle(); assert.equal(f.grants, 0);
  assert.equal(f.enroll.onState(connected("a")), undefined); f.enroll.onState(connected("a"));
  await settle(); assert.equal(f.grants, 1); assert.equal(f.requests.length, 1);
  const [path, init] = f.requests[0];
  assert.equal(path, "/api/dashboard/link"); assert.equal(init.method, "POST"); assert.deepEqual(init.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(init.body), { url: grant.dashboardUrl, enrollToken: grant.enrollToken }); assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(f.memory, { accountId: "a", dashboardUrl: grant.dashboardUrl, workspaceId: "workspace", at: f.memory.at }); assert.ok(Number.isSafeInteger(f.memory.at));
  f.enroll.onState(connected("a")); await settle(); assert.equal(f.grants, 1);
  f.enroll.onState(connected("b")); await settle(); assert.equal(f.grants, 2); assert.equal(f.memory.accountId, "b");
  assert.equal(f.timers.size, 0); assert.deepEqual(f.logs, []); f.enroll.close();
});

test("failures retry at one, five and fifteen minutes, at most three times per account per launch", async () => {
  const f = fixture(); f.status = 502;
  f.enroll.onState(connected("a")); await settle();
  for (let i = 0; i < 3; i++) { f.enroll.onState(connected("a")); await settle(); await f.tick(); }
  assert.deepEqual(f.delays, [60_000, 300_000, 900_000]); assert.equal(f.grants, 4); assert.equal(f.timers.size, 0);
  f.enroll.onState(connected("a")); await settle(); assert.equal(f.grants, 4); assert.equal(f.writes.length, 0);
  assert.equal(f.logs.length, 4); assert.ok(f.logs.every(line => !line.includes(grant.enrollToken)));
  f.enroll.onState(connected("b")); await settle(); assert.equal(f.grants, 5); assert.equal(f.delays.at(-1), 60_000);
  f.enroll.onState(connected("a")); await settle(); assert.equal(f.grants, 5); f.enroll.close();
});

test("null grants, unclaimed answers, malformed JSON and thrown dependencies retry without throwing or logging secrets", async () => {
  for (const options of [
    { client: () => ({ enrollGrant: async () => null }) },
    { localRequest: async () => ({ status: 200, json: async () => ({ claimed: false }) }) },
    { localRequest: async () => ({ status: 201, json: async () => ({ claimed: true, workspaceId: "workspace" }) }) },
    { localRequest: async () => ({ status: 200, json: async () => { throw new Error(grant.enrollToken); } }) },
    { readMemory: () => { throw new Error(grant.enrollToken); } },
    { writeMemory: () => { throw new Error(grant.enrollToken); } },
  ]) {
    const f = fixture(options); assert.doesNotThrow(() => f.enroll.onState(connected("a"))); await settle();
    assert.equal(f.logs.length, 1); assert.equal(f.timers.size, 1); assert.ok(!f.logs[0].includes(grant.enrollToken)); f.enroll.close();
  }
});

test("an account change discards stale grants and serializes the new account behind an in-flight attempt", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture({ client: () => ({ enrollGrant: async () => { f.grants++; return f.grants === 1 ? pending : grant; } }) });
  f.enroll.onState(connected("a")); await settle(); f.enroll.onState(connected("b")); await settle(); assert.equal(f.grants, 1);
  resolve(grant); await settle(); assert.equal(f.grants, 2); assert.equal(f.requests.length, 1); assert.equal(f.writes.length, 1); assert.equal(f.memory.accountId, "b"); f.enroll.close();
});

test("account changes clear old retry timers, and close cancels timers and ignores pending responses", async () => {
  const f = fixture(); f.status = 500; f.enroll.onState(connected("a")); await settle();
  f.enroll.onState({ status: "signed-out" }); assert.equal(f.timers.size, 0);
  f.enroll.onState(connected("b")); await settle(); assert.equal(f.timers.size, 1);
  f.enroll.close(); assert.equal(f.timers.size, 0); f.enroll.onState(connected("c")); await settle(); assert.equal(f.grants, 2);
  let finish;
  const pending = fixture({ localRequest: () => new Promise(resolve => { finish = resolve; }) });
  pending.enroll.onState(connected("a")); await settle(); pending.enroll.close();
  finish({ status: 200, json: async () => ({ claimed: true, workspaceId: "workspace" }) }); await settle(); assert.deepEqual(pending.writes, []); assert.equal(pending.timers.size, 0);
});
