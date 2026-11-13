import { describe, expect, it } from "vitest";

import { ACTIVE_MS, BURST_MIN, CAP_BYTES_PER_S, FLOOR_BYTES_PER_S, FULL_SPEED_BYTES, GB, accountReport, burstFor, createBucket, monthOf, tierRate } from "../src/fair-use.js";

describe("tierRate", () => {
  it("is full speed (25 Mbit/s) up to 50 GB", () => {
    expect(CAP_BYTES_PER_S * 8).toBe(25_000_000);
    expect(tierRate(0)).toBe(CAP_BYTES_PER_S);
    expect(tierRate(FULL_SPEED_BYTES)).toBe(CAP_BYTES_PER_S);
  });
  it("halves for every 50 GB past that, gradually", () => {
    expect(tierRate(75 * GB)).toBeLessThan(CAP_BYTES_PER_S);
    expect(tierRate(75 * GB)).toBeGreaterThan(CAP_BYTES_PER_S / 2);
    expect(tierRate(100 * GB)).toBe(Math.floor(CAP_BYTES_PER_S / 2));
    expect(tierRate(150 * GB)).toBe(Math.floor(CAP_BYTES_PER_S / 4));
    let last = Infinity;
    for (let gb = 50; gb <= 1000; gb += 10) { const rate = tierRate(gb * GB); expect(rate).toBeLessThanOrEqual(last); last = rate; }
  });
  it("never cuts off: a floor of 2 Mbit/s", () => {
    expect(tierRate(10_000 * GB)).toBe(FLOOR_BYTES_PER_S);
    expect(FLOOR_BYTES_PER_S).toBeGreaterThan(0);
  });
  it("gives a burst of seconds of the rate, never below the minimum", () => {
    expect(burstFor(CAP_BYTES_PER_S)).toBe(CAP_BYTES_PER_S * 8);
    expect(burstFor(1)).toBe(BURST_MIN);
  });
});

describe("createBucket", () => {
  it("lets a burst through at once, then holds to the rate", () => {
    let t = 0;
    const bucket = createBucket({ rate: 1000, burst: 5000, now: () => t });
    expect(bucket.take(5000)).toBe(0);
    expect(bucket.take(1)).toBe(0);
    expect(bucket.take(1)).toBeGreaterThan(0);
    t += 1000;
    expect(bucket.take(500)).toBe(0);
  });
  it("sends a message bigger than the burst instead of waiting forever, then waits off the debt", () => {
    let t = 0;
    const bucket = createBucket({ rate: 1000, burst: 100, now: () => t });
    expect(bucket.take(10_000)).toBe(0);
    const wait = bucket.take(10);
    expect(wait).toBeGreaterThanOrEqual(9900);
    t += wait;
    expect(bucket.take(10)).toBe(0);
  });
  it("takes a new rate without granting a fresh burst", () => {
    let t = 0;
    const bucket = createBucket({ rate: 1000, burst: 10_000, now: () => t });
    bucket.take(10_000);
    bucket.set(100, 1000);
    expect(bucket.rate).toBe(100);
    expect(bucket.tokens).toBeLessThanOrEqual(0);
  });
});

describe("accountReport", () => {
  const acct = { tunnel: "aaaaaaaaaa", t: Date.UTC(2026, 10, 13) };
  it("adds bytes for the month and starts over in a new month", () => {
    let { state } = accountReport(null, { ...acct, bytes: 10 });
    ({ state } = accountReport(state, { ...acct, bytes: 5 }));
    expect(state.bytes).toBe(15);
    expect(state.month).toBe("2026-11");
    ({ state } = accountReport(state, { ...acct, bytes: 1, t: Date.UTC(2026, 11, 1) }));
    expect(state).toMatchObject({ month: "2026-12", bytes: 1 });
  });
  it("shares the account's rate among its active tunnels, so more servers do not mean more speed", () => {
    let { state, answer } = accountReport(null, { ...acct, bytes: 0 });
    expect(answer.rate).toBe(CAP_BYTES_PER_S);
    ({ state, answer } = accountReport(state, { ...acct, tunnel: "bbbbbbbbbb", bytes: 0 }));
    expect(answer.active).toBe(2);
    expect(answer.rate).toBe(Math.floor(CAP_BYTES_PER_S / 2));
    ({ answer } = accountReport(state, { ...acct, tunnel: "bbbbbbbbbb", bytes: 0, t: acct.t + ACTIVE_MS + 1 }));
    expect(answer.active).toBe(1);
  });
  it("notes when the month first went past full speed", () => {
    const { state, answer } = accountReport(null, { ...acct, bytes: 60 * GB });
    expect(answer.accountRate).toBeLessThan(CAP_BYTES_PER_S);
    expect(state.slowedAt).toBe(acct.t);
    expect(monthOf(acct.t)).toBe("2026-11");
  });
});
