import { describe, expect, it } from "vitest";

import { CAP_BYTES_PER_S, DEFAULT_LIMITS, FLOOR_BYTES_PER_S, GB, accountReport, tunnelAnswer } from "../src/fair-use.js";
import { DO_PRICE, admitTunnel, applyLimits, costCents, globalShareOf, isBusy, monthElapsed, normalizeLimits, projected } from "../src/ops.js";

describe("limits", () => {
  it("fills stored limits over the defaults and drops unknown keys", () => {
    expect(normalizeLimits(null)).toEqual(DEFAULT_LIMITS);
    expect(normalizeLimits({ maxTunnels: 3, nope: 1 })).toEqual({ ...DEFAULT_LIMITS, maxTunnels: 3 });
  });
  it("takes known keys in range, null for off and a boolean pause", () => {
    const done = applyLimits(DEFAULT_LIMITS, { maxTunnels: 10, globalCeilingBytesPerSec: 50_000_000, perTunnelDailyBytes: null, paused: true });
    expect(done).toMatchObject({ ok: true, limits: { maxTunnels: 10, globalCeilingBytesPerSec: 50_000_000, perTunnelDailyBytes: null, paused: true } });
  });
  it("refuses unknown keys, bad numbers, off for a required one and a floor above full speed", () => {
    expect(applyLimits(DEFAULT_LIMITS, { speed: 1 }).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, { maxTunnels: -1 }).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, { maxTunnels: 1.5 }).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, { maxTunnels: "5" }).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, { accountBytesPerSec: null }).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, { paused: "yes" }).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, { floorBytesPerSec: CAP_BYTES_PER_S + 1 }).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, {}).ok).toBe(false);
    expect(applyLimits(DEFAULT_LIMITS, [1]).ok).toBe(false);
  });
});

describe("admitTunnel", () => {
  const limits = { ...DEFAULT_LIMITS, maxTunnels: 2, tunnelsPerAccount: 1 };
  it("lets one in under the caps", () => expect(admitTunnel(limits, { known: false, total: 1, forAccount: 0 })).toBeNull());
  it("answers busy at the relay's cap and while paused", () => {
    expect(admitTunnel(limits, { known: false, total: 2, forAccount: 0 })?.code).toBe("relay_busy");
    expect(admitTunnel({ ...limits, paused: true }, { known: false, total: 0, forAccount: 0 })?.code).toBe("relay_busy");
  });
  it("holds an account to its tunnels", () => expect(admitTunnel(limits, { known: false, total: 0, forAccount: 1 })?.code).toBe("account_tunnels"));
  it("always lets a tunnel already on come back (a reconnect or a deploy)", () => expect(admitTunnel({ ...limits, paused: true }, { known: true, total: 9, forAccount: 9 })).toBeNull());
  it("is busy when paused or full", () => {
    expect(isBusy(limits, 1)).toBe(false);
    expect(isBusy(limits, 2)).toBe(true);
    expect(isBusy({ ...limits, maxTunnels: null, paused: true }, 0)).toBe(true);
  });
});

describe("rates under the owner's limits", () => {
  const t = Date.UTC(2026, 10, 13, 12);
  it("caps one tunnel and splits the global ceiling evenly", () => {
    const limits = { ...DEFAULT_LIMITS, perTunnelBytesPerSec: 1_000_000, globalCeilingBytesPerSec: 3_000_000 };
    const { answer } = accountReport(null, { tunnel: "aaaaaaaaaa", bytes: 0, t }, { limits, globalShare: globalShareOf(limits, 6) });
    expect(answer.rate).toBe(500_000);
    expect(globalShareOf(DEFAULT_LIMITS, 6)).toBeNull();
    expect(tunnelAnswer(accountReport(null, { tunnel: "aaaaaaaaaa", bytes: 0, t }, { limits }).state, { tunnel: "aaaaaaaaaa", t }, { limits }).rate).toBe(1_000_000);
  });
  it("drops a tunnel past its daily bytes to the floor, and a new day starts fresh", () => {
    const limits = { ...DEFAULT_LIMITS, perTunnelDailyBytes: 1 * GB };
    let { state, answer } = accountReport(null, { tunnel: "aaaaaaaaaa", bytes: 2 * GB, t }, { limits });
    expect(answer.rate).toBe(FLOOR_BYTES_PER_S);
    ({ answer } = accountReport(state, { tunnel: "bbbbbbbbbb", bytes: 0, t }, { limits }));
    expect(answer.rate).toBe(Math.floor(CAP_BYTES_PER_S / 2));
    ({ state, answer } = accountReport(state, { tunnel: "aaaaaaaaaa", bytes: 0, t: t + 86_400_000 }, { limits }));
    expect(answer.rate).toBe(CAP_BYTES_PER_S);
  });
  it("uses a set burst and the owner's account speed", () => {
    const limits = { ...DEFAULT_LIMITS, burstBytes: 1_000_000, accountBytesPerSec: 1_250_000, perTunnelBytesPerSec: null };
    const { state, answer } = accountReport(null, { tunnel: "aaaaaaaaaa", bytes: 10, bytesOut: 7, bytesIn: 3, awakeMs: 5, messages: 2, t }, { limits });
    expect(answer).toMatchObject({ rate: 1_250_000, burst: 1_000_000 });
    expect(state).toMatchObject({ bytesOut: 7, bytesIn: 3, awakeMs: 5, messages: 2, day: "2026-11-13" });
  });
});

describe("cost and projection", () => {
  it("prices awake time and messages like the README table", () => {
    // an hour awake is about $0.0056
    expect(costCents({ awakeMs: 3_600_000, messages: 0 })).toBeCloseTo(0.5625, 4);
    expect(costCents({ awakeMs: 0, messages: 20_000_000 })).toBeCloseTo(DO_PRICE.centsPerMessage * 20_000_000, 6);
    expect(costCents({ awakeMs: 0, messages: 20_000_000 })).toBeCloseTo(15, 6);
  });
  it("projects a month's figure at the pace so far", () => {
    const half = Date.UTC(2026, 10, 16);
    expect(monthElapsed(half)).toBeCloseTo(0.5, 5);
    expect(projected(100, half)).toBe(200);
  });
});
