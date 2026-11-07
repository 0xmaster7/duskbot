import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { independentScreenTarget } from "./shared-desktop-screens.ts";
import { createVpsLifecycleManager, type VpsLifecycleDeps, type VpsLifecycleResource, type VpsLifecycleState } from "./vps-lifecycle.ts";
import type { VpsLifecyclePolicy } from "./vps-config.ts";

const minute = 60_000;
const resource: VpsLifecycleResource = { ownerId: "computer_shared", sshAlias: "fixture-vps", containerId: "a".repeat(64) };
const descriptor = { botId: "bot-a", screen: independentScreenTarget("bot-a", 2) };
const other = { botId: "bot-b", screen: independentScreenTarget("bot-b", 3) };
const tick = async () => { for (let count = 0; count < 20; count += 1) await Promise.resolve(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(overrides: Partial<VpsLifecycleDeps> = {}, initial: VpsLifecycleState | null = null) {
  let disk = initial;
  let policy: VpsLifecyclePolicy = { browserIdleMinutes: 1, screenIdleMinutes: 2, computerIdleMinutes: 3 };
  let busy = false, current = true;
  const perform = vi.fn<VpsLifecycleDeps["perform"]>(async (_stage, _target, allowed) => allowed() ? "done" : "busy");
  const save = vi.fn<VpsLifecycleDeps["save"]>(async state => { disk = structuredClone(state); });
  const failed = vi.fn(), completed = vi.fn();
  const manager = createVpsLifecycleManager({ policy: () => policy, load: () => disk, save, current: () => current, busy: () => busy, perform, failed, completed,
    coalesceMs: 10, busyRetryMs: 100, retryMs: [100, 200], ...overrides });
  return { manager, perform, save, failed, completed, disk: () => disk, busy: (value: boolean) => { busy = value; }, current: (value: boolean) => { current = value; },
    policy: (value: VpsLifecyclePolicy) => { policy = value; manager.configure(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

describe("durable staged computer lifecycle", () => {
  it("closes browsers, then exact screens, then the container without waking or deleting resources", async () => {
    const f = fixture(); await f.manager.ready;
    f.manager.activity(resource, descriptor);
    await vi.advanceTimersByTimeAsync(minute);
    expect(f.perform.mock.calls.map(([stage]) => stage)).toEqual(["browser"]);
    expect(f.perform.mock.calls[0]![1]).toMatchObject({ ...resource, ...descriptor });
    await vi.advanceTimersByTimeAsync(minute);
    expect(f.perform.mock.calls.map(([stage]) => stage)).toEqual(["browser", "screen"]);
    await vi.advanceTimersByTimeAsync(minute);
    expect(f.perform.mock.calls.map(([stage]) => stage)).toEqual(["browser", "screen", "computer"]);
    expect(f.perform.mock.calls[2]![1]).toEqual(resource);
    await vi.advanceTimersByTimeAsync(10 * minute);
    expect(f.perform).toHaveBeenCalledTimes(3);
    await f.manager.close();
  });
  it("uses the latest actual bot activity for the shared container while isolating screen deadlines", async () => {
    const f = fixture(); await f.manager.ready;
    f.manager.activity(resource, descriptor);
    await vi.advanceTimersByTimeAsync(30_000);
    f.manager.activity(resource, other);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.perform.mock.calls.map(([stage, target]) => [stage, target.botId])).toEqual([["browser", descriptor.botId]]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.perform.mock.calls.map(([stage, target]) => [stage, target.botId])).toEqual([["browser", descriptor.botId], ["browser", other.botId]]);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.perform.mock.calls.some(([stage]) => stage === "computer")).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.perform.mock.calls.at(-1)![0]).toBe("computer");
    await f.manager.close();
  });
  it("ignores repeated status and passive watch observations", async () => {
    const f = fixture(); await f.manager.ready;
    f.manager.observe(resource); f.manager.observeScreen(resource, descriptor);
    for (let count = 0; count < 5; count += 1) {
      await vi.advanceTimersByTimeAsync(10_000);
      f.manager.observe({ ...resource }); f.manager.observeScreen({ ...resource }, { ...descriptor });
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.perform.mock.calls[0]![0]).toBe("browser");
    await f.manager.close();
  });
  it("restores the original deadline after restart and never acts before a fresh ownership observation", async () => {
    const first = fixture(); await first.manager.ready;
    first.manager.activity(resource, descriptor);
    await vi.advanceTimersByTimeAsync(50_000);
    await first.manager.close();
    const second = fixture({}, first.disk()); await second.manager.ready;
    await vi.advanceTimersByTimeAsync(5000);
    expect(second.perform).not.toHaveBeenCalled();
    second.manager.observe(resource); second.manager.observeScreen(resource, descriptor);
    await vi.advanceTimersByTimeAsync(4999);
    expect(second.perform).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.perform.mock.calls[0]![0]).toBe("browser");
    await second.manager.close();
  });
  it("catches up only the deepest due stage after a long downtime", async () => {
    const first = fixture(); await first.manager.ready;
    first.manager.activity(resource, descriptor); await first.manager.close();
    vi.setSystemTime(Date.now() + 4 * minute);
    const second = fixture({}, first.disk()); await second.manager.ready;
    second.manager.observe(resource); second.manager.observeScreen(resource, descriptor); await tick();
    expect(second.perform.mock.calls.map(([stage]) => stage)).toEqual(["computer"]);
    await second.manager.close();
  });
  it("protects human holds and turns without manufacturing a fresh activity timestamp", async () => {
    const f = fixture(); await f.manager.ready;
    f.manager.activity(resource, descriptor); f.busy(true);
    const timestamp = f.manager.snapshot().entries[0]!.lastActivityAt;
    await vi.advanceTimersByTimeAsync(minute + 500);
    expect(f.perform).not.toHaveBeenCalled();
    expect(f.manager.snapshot().entries.every(entry => entry.lastActivityAt === timestamp)).toBe(true);
    f.busy(false); await vi.advanceTimersByTimeAsync(100);
    expect(f.perform.mock.calls[0]![0]).toBe("browser");
    await f.manager.close();
  });
  it("aborts pending effects when real activity arrives and does not mark the new epoch complete", async () => {
    const gate = deferred(), effects: boolean[] = [];
    const perform = vi.fn<VpsLifecycleDeps["perform"]>(async (_stage, _target, allowed, signal) => { await gate.promise; effects.push(allowed() && !signal.aborted); return "done"; });
    const f = fixture({ perform }); await f.manager.ready;
    f.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(minute);
    expect(perform).toHaveBeenCalledOnce();
    f.manager.activity(resource, descriptor);
    expect(perform.mock.calls[0]![3].aborted).toBe(true);
    gate.resolve(); await tick();
    expect(effects).toEqual([false]);
    expect(f.manager.snapshot().entries.every(entry => entry.completed.length === 0)).toBe(true);
    await f.manager.close();
  });
  it("pins identity and rejects late cleanup after cancellation or reassignment", async () => {
    const gate = deferred();
    const perform = vi.fn<VpsLifecycleDeps["perform"]>(async (_stage, _target, allowed) => { await gate.promise; expect(allowed()).toBe(false); return "done"; });
    const f = fixture({ perform }); await f.manager.ready;
    const mutable = { ...resource };
    f.manager.activity(mutable, descriptor); mutable.containerId = "b".repeat(64);
    await vi.advanceTimersByTimeAsync(minute);
    expect(perform.mock.calls[0]![1].containerId).toBe(resource.containerId);
    f.manager.cancel(resource); gate.resolve(); await tick();
    expect(f.manager.snapshot().entries).toEqual([]);
    await f.manager.close();
  });
  it("forgets only the matching child generation, aborting its pending cleanup without changing shared clocks", async () => {
    const gate = deferred();
    const perform = vi.fn<VpsLifecycleDeps["perform"]>(async (_stage, _target, allowed, signal) => { await gate.promise; expect(allowed()).toBe(false); expect(signal.aborted).toBe(true); return "done"; });
    const f = fixture({ perform }); await f.manager.ready;
    f.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(30_000);
    f.manager.activity(resource, other); await vi.advanceTimersByTimeAsync(30_000);
    expect(perform).toHaveBeenCalledOnce();
    const before = f.manager.snapshot();
    f.manager.forgetScreen({ ...resource, containerId: "b".repeat(64) }, descriptor.botId, descriptor.screen.generation);
    f.manager.forgetScreen(resource, descriptor.botId, other.screen.generation);
    expect(f.manager.snapshot()).toEqual(before);
    const retained = before.entries.filter(entry => entry.target.botId !== descriptor.botId);
    f.manager.forgetScreen(resource, descriptor.botId, descriptor.screen.generation);
    expect(f.manager.snapshot().entries).toEqual(retained);
    gate.resolve(); await tick(); await f.manager.flush();
    expect(f.disk()!.entries).toEqual(retained);
    await f.manager.close();
  });
  it("limits global cleanup to two operations and serializes each physical container", async () => {
    const gates = Array.from({ length: 3 }, deferred);
    let running = 0, peak = 0, calls = 0;
    const perform = vi.fn<VpsLifecycleDeps["perform"]>(async () => { peak = Math.max(peak, ++running); const index = calls++; await gates[index]!.promise; running -= 1; return "done"; });
    const f = fixture({ perform }); await f.manager.ready;
    for (let index = 0; index < 3; index += 1) f.manager.activity({ ...resource, ownerId: `owner-${index}`, containerId: `${index + 1}`.repeat(64) }, descriptor);
    await vi.advanceTimersByTimeAsync(minute);
    expect(perform).toHaveBeenCalledTimes(2);
    gates[0]!.resolve(); await tick();
    expect(perform).toHaveBeenCalledTimes(3);
    expect(peak).toBe(2);
    gates[1]!.resolve(); gates[2]!.resolve(); await tick();
    await f.manager.close();
  });
  it("persists bounded retry state across restart without resetting inactivity", async () => {
    const perform = vi.fn<VpsLifecycleDeps["perform"]>().mockRejectedValue(new Error("offline"));
    const first = fixture({ perform }); await first.manager.ready;
    first.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(minute);
    expect(perform).toHaveBeenCalledOnce(); await first.manager.close();
    const second = fixture({ perform }, first.disk()); await second.manager.ready;
    second.manager.observe(resource); second.manager.observeScreen(resource, descriptor);
    await vi.advanceTimersByTimeAsync(99); expect(perform).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(perform).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); expect(perform).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000); expect(perform).toHaveBeenCalledTimes(3);
    expect(second.failed.mock.calls.at(-1)![2]).toBeNull();
    second.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(minute);
    expect(perform).toHaveBeenCalledTimes(4);
    await second.manager.close();
  });
  it("allows the later screen stage to supersede an exhausted browser stage", async () => {
    const f = fixture({ retryMs: [], perform: vi.fn<VpsLifecycleDeps["perform"]>(async stage => { if (stage === "browser") throw new Error("browser unavailable"); return "done"; }) }); await f.manager.ready;
    f.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(2 * minute);
    const performed = f.manager.snapshot().entries.find(entry => entry.target.botId)?.completed;
    expect(performed).toEqual(["browser", "screen"]);
    await f.manager.close();
  });
  it("backs off a busy reservation at a later stage even after an earlier stage failed", async () => {
    const perform = vi.fn<VpsLifecycleDeps["perform"]>(async stage => {
      if (stage === "browser") throw new Error("browser unavailable");
      return "busy";
    });
    const f = fixture({ retryMs: [], perform }); await f.manager.ready;
    f.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(2 * minute);
    expect(perform.mock.calls.map(([stage]) => stage)).toEqual(["browser", "screen"]);
    await vi.advanceTimersByTimeAsync(99); expect(perform).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(perform).toHaveBeenCalledTimes(3);
    await f.manager.close();
  });
  it("clamps future restored timestamps before aggregating the container clock", async () => {
    const first = fixture(); await first.manager.ready;
    first.manager.activity(resource, descriptor); await first.manager.close();
    const state = first.disk()!;
    for (const entry of state.entries) entry.lastActivityAt = Date.now() + 30 * minute;
    const second = fixture({}, state); await second.manager.ready;
    expect(second.manager.snapshot().entries.every(entry => entry.lastActivityAt === Date.now())).toBe(true);
    await second.manager.close();
  });
  it("discards future-clock retry deadlines when correcting restored activity timestamps", async () => {
    const first = fixture(); await first.manager.ready;
    first.manager.activity(resource, descriptor); await first.manager.close();
    const state = first.disk()!;
    for (const entry of state.entries) {
      entry.lastActivityAt = Date.now() + 365 * 24 * 60 * minute;
      entry.retryAt = entry.lastActivityAt + minute;
      entry.failedStage = entry.target.botId ? "browser" : "computer";
      entry.failures = 1;
    }
    const second = fixture({}, state); await second.manager.ready;
    second.manager.observe(resource); second.manager.observeScreen(resource, descriptor);
    await second.manager.flush();
    expect(second.disk()!.entries.every(entry => entry.lastActivityAt === Date.now() && entry.retryAt === undefined)).toBe(true);
    await vi.advanceTimersByTimeAsync(minute - 1); expect(second.perform).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(second.perform.mock.calls.map(([stage]) => stage)).toEqual(["browser"]);
    await second.manager.close();
  });
  it("fails closed on corrupt persisted state and refuses to overwrite it", async () => {
    const f = fixture({ load: () => { throw new Error("corrupt state"); } }); await f.manager.ready;
    f.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(10 * minute);
    expect(f.perform).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(f.failed).toHaveBeenCalledOnce();
    await expect(f.manager.flush()).rejects.toThrow("unavailable");
    await f.manager.close();
  });
  it("never performs cleanup until the activity epoch has been durably saved", async () => {
    let failing = true;
    const save = vi.fn<VpsLifecycleDeps["save"]>(async () => { if (failing) throw new Error("disk unavailable"); });
    const f = fixture({ save }); await f.manager.ready;
    f.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(minute);
    expect(f.perform).not.toHaveBeenCalled();
    failing = false; await f.manager.flush(); await tick();
    expect(f.perform).toHaveBeenCalledOnce();
    await f.manager.close();
  });
  it("deeply snapshots pending observations and coalesces repeated actual input saves", async () => {
    const loaded = deferred();
    const f = fixture({ load: async () => { await loaded.promise; return null; } });
    const mutable = { ...resource };
    f.manager.activity(mutable, descriptor); mutable.sshAlias = "foreign-vps"; loaded.resolve(); await f.manager.ready;
    for (let count = 0; count < 100; count += 1) f.manager.activity(resource, descriptor);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.manager.snapshot().entries.every(entry => entry.target.sshAlias === resource.sshAlias)).toBe(true);
    await f.manager.close();
  });
  it("flushes real activity queued before a delayed load even when shutdown begins first", async () => {
    const first = fixture(); await first.manager.ready;
    first.manager.activity(resource, descriptor); await first.manager.close();
    vi.setSystemTime(Date.now() + 50_000);
    const loaded = deferred();
    const second = fixture({ load: async () => { await loaded.promise; return first.disk(); } });
    second.manager.activity(resource, descriptor);
    const closing = second.manager.close();
    loaded.resolve(); await closing;
    expect(second.disk()!.entries.every(entry => entry.lastActivityAt === Date.now())).toBe(true);
    expect(second.perform).not.toHaveBeenCalled();
    const third = fixture({}, second.disk()); await third.manager.ready;
    third.manager.observe(resource); third.manager.observeScreen(resource, descriptor);
    await vi.advanceTimersByTimeAsync(minute - 1); expect(third.perform).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(third.perform).toHaveBeenCalledOnce();
    await third.manager.close();
  });
  it("reconfigures deadlines from original activity and preserves all-off policy", async () => {
    const f = fixture(); await f.manager.ready;
    f.manager.activity(resource, descriptor); await vi.advanceTimersByTimeAsync(30_000);
    f.policy({ browserIdleMinutes: 0, screenIdleMinutes: 0, computerIdleMinutes: 0 });
    await vi.advanceTimersByTimeAsync(10 * minute); expect(f.perform).not.toHaveBeenCalled();
    f.policy({ browserIdleMinutes: 1, screenIdleMinutes: 2, computerIdleMinutes: 3 }); await tick();
    expect(f.perform.mock.calls.map(([stage]) => stage)).toEqual(["computer"]);
    await f.manager.close();
  });
});
