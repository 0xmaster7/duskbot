import { describe, expect, it, vi } from "vitest";
import { createSharedScreenBroker, independentScreenTarget, type SharedScreenHooks } from "./shared-desktop-screens.ts";

const container = { sshAlias: "fixture-vps", ownerId: "computer_shared", containerId: "a".repeat(64) };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(extra: Partial<SharedScreenHooks> = {}) {
  const hooks: SharedScreenHooks = { reset: vi.fn(async () => {}), start: vi.fn(async () => {}), stop: vi.fn(async () => {}), revoke: vi.fn(), ...extra };
  return { broker: createSharedScreenBroker(hooks), hooks };
}

describe("exact-generation lifecycle broker guards", () => {
  it("protects active turns and human holds from browser or screen cleanup", async () => {
    const { broker, hooks } = fixture();
    for (const kind of ["turn", "hold"] as const) {
      const lease = await broker.acquire(container, kind, { kind });
      const action = vi.fn(async () => {});
      expect(await broker.withIdleScreen(container, lease.target, action)).toBe(false);
      expect(await broker.closeScreen(container, lease.target)).toBe(false);
      expect(action).not.toHaveBeenCalled(); expect(hooks.stop).not.toHaveBeenCalled(); expect(lease.live()).toBe(true);
      lease.release();
    }
    await broker.close();
  });
  it("queues new consumers during browser cleanup and preserves the same profile afterwards", async () => {
    const { broker } = fixture(); const watch = await broker.acquire(container, "bot", { kind: "watch" });
    const gate = deferred(); let allowed!: () => boolean;
    const cleanup = broker.withIdleScreen(container, watch.target, async stillIdle => { allowed = stillIdle; await gate.promise; });
    await tick(); expect(allowed()).toBe(true); expect(broker.screenBusy(container, watch.target)).toBe(true);
    let admitted = false;
    const next = broker.acquire(container, "bot", { kind: "turn" }).then(lease => { admitted = true; return lease; });
    await tick(); expect(admitted).toBe(false);
    gate.resolve(); expect(await cleanup).toBe(true);
    const lease = await next; expect(lease.target.generation).toBe(watch.target.generation); expect(watch.live()).toBe(true);
    expect(broker.screenBusy(container, lease.target)).toBe(true);
    expect(broker.screenBusy(container, independentScreenTarget("other", 3))).toBe(false);
    await broker.close();
  });
  it("awaits exact-generation screen retirement and revokes viewers before a new generation can start", async () => {
    const gate = deferred(), events: string[] = [];
    const { broker } = fixture({ revoke: () => { events.push("revoke"); }, stop: async () => { events.push("stop"); await gate.promise; }, start: async () => { events.push("start"); } });
    const watch = await broker.acquire(container, "bot", { kind: "watch" }); events.length = 0;
    let settled = false;
    const cleanup = broker.closeScreen(container, watch.target).then(value => { settled = true; return value; });
    const next = broker.acquire(container, "bot", { kind: "turn" });
    await tick(); expect(watch.live()).toBe(false); expect(settled).toBe(false); expect(events).toEqual(["revoke", "stop"]);
    gate.resolve(); expect(await cleanup).toBe(true);
    expect((await next).target.generation).not.toBe(watch.target.generation); expect(events).toEqual(["revoke", "stop", "start"]);
    expect(await broker.closeScreen(container, watch.target)).toBe(false);
    await broker.close();
  });
  it("releases the pending guard after a failed browser cleanup so consumers can proceed", async () => {
    const { broker } = fixture(); const watch = await broker.acquire(container, "bot", { kind: "watch" });
    const failed = broker.withIdleScreen(container, watch.target, async () => { throw new Error("offline"); });
    const next = broker.acquire(container, "bot", { kind: "turn" });
    await expect(failed).rejects.toThrow("offline"); expect((await next).live()).toBe(true);
    await broker.close();
  });
  it("adopts only a verified existing generation without resetting or starting any guest session", async () => {
    const { broker, hooks } = fixture(); const target = independentScreenTarget("bot", 2);
    const adopted = broker.adoptVerifiedScreen(container, target);
    expect(adopted.live()).toBe(true); expect(hooks.reset).not.toHaveBeenCalled(); expect(hooks.start).not.toHaveBeenCalled();
    const active = await broker.acquire(container, "bot", { kind: "turn" }); expect(active.target).toEqual(target);
    await broker.acquire(container, "another", { kind: "turn" }); expect(hooks.reset).not.toHaveBeenCalled();
    expect(() => broker.adoptVerifiedScreen(container, independentScreenTarget("foreign", 2))).toThrow(/conflicts/);
    expect(() => broker.adoptVerifiedScreen(container, independentScreenTarget("bot", 3))).toThrow(/conflicts/);
    expect(() => broker.adoptVerifiedScreen({ ...container, ownerId: "foreign" }, target)).toThrow(/different computer owner/);
    await broker.close();
  });
  it("refuses forged targets and cannot run a deferred effect after container revocation", async () => {
    const { broker } = fixture(); const watch = await broker.acquire(container, "bot", { kind: "watch" });
    expect(() => broker.adoptVerifiedScreen(container, { ...watch.target, socket: "/foreign.sock" })).toThrow();
    const action = vi.fn(async () => {});
    const pending = broker.withIdleScreen(container, watch.target, action);
    const closing = broker.closeContainer(container);
    expect(await pending).toBe(false); await closing; expect(action).not.toHaveBeenCalled();
    await broker.close();
  });
});
