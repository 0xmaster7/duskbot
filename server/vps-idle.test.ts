import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVpsIdleManager, type VpsIdleDeps, type VpsIdleTarget } from "./vps-idle.ts";

const target: VpsIdleTarget = { ownerId: "computer_shared", sshAlias: "fixture-vps", containerId: "a".repeat(64) };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(overrides: Partial<VpsIdleDeps> = {}) {
  let idleMs = 1_000;
  let busy = false;
  let current = true;
  const stop = vi.fn<VpsIdleDeps["stop"]>(async (_target, allowed) => allowed() ? "stopped" : "busy");
  const stopped = vi.fn(), failed = vi.fn();
  const manager = createVpsIdleManager({ idleMs: () => idleMs, busy: () => busy, current: () => current, stop, stopped, failed, ...overrides });
  return { manager, stop, stopped, failed,
    busy: (value: boolean) => { busy = value; }, current: (value: boolean) => { current = value; },
    idle: (value: number) => { idleMs = value; manager.configure(); },
  };
}

describe("own-VPS idle lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stops only after a full quiet window and restarts the window on actual activity", async () => {
    const f = fixture();
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(700);
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.stop).toHaveBeenCalledExactlyOnceWith(target, expect.any(Function));
    expect(f.stopped).toHaveBeenCalledExactlyOnceWith(target);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("shares one physical-target timer across repeated member actions and snapshots the supplied target", async () => {
    const f = fixture();
    const memberTarget = { ...target };
    f.manager.activity(memberTarget);
    await vi.advanceTimersByTimeAsync(500);
    f.manager.activity({ ...target });
    memberTarget.sshAlias = "unrelated-host";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.stop).toHaveBeenCalledExactlyOnceWith(target, expect.any(Function));
  });

  it("adopts a running computer once and ignores repeated status and watch observations", async () => {
    const f = fixture();
    f.manager.observe(target);
    for (let poll = 0; poll < 4; poll++) {
      await vi.advanceTimersByTimeAsync(200);
      f.manager.observe({ ...target });
    }
    await vi.advanceTimersByTimeAsync(199);
    expect(f.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("keeps different aliases independent even when their owner ids match", async () => {
    const f = fixture();
    f.manager.activity(target);
    f.manager.activity({ ...target, sshAlias: "other-vps" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.stop).toHaveBeenCalledTimes(2);
    expect(f.stop.mock.calls.map(([value]) => value.sshAlias)).toEqual(["fixture-vps", "other-vps"]);
  });

  it.each(["GUI turn", "person hold", "lifecycle operation"])("never stops during a %s and waits a fresh window after it becomes quiet", async () => {
    const f = fixture();
    f.busy(true);
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(2_450);
    expect(f.stop).not.toHaveBeenCalled();
    f.busy(false);
    await vi.advanceTimersByTimeAsync(1_049);
    expect(f.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("supports off and applies timeout changes from the last real activity", async () => {
    const f = fixture();
    f.idle(0);
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(900);
    expect(f.stop).not.toHaveBeenCalled();
    f.idle(2_000);
    await vi.advanceTimersByTimeAsync(1_099);
    expect(f.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("extends a live window and cancels it when auto sleep is turned off", async () => {
    const f = fixture();
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(900);
    f.idle(2_000);
    await vi.advanceTimersByTimeAsync(900);
    expect(f.stop).not.toHaveBeenCalled();
    f.idle(0);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.stop).not.toHaveBeenCalled();
  });

  it("retires a changed or deleted assignment without stopping its old target", async () => {
    const f = fixture();
    f.manager.activity(target);
    f.current(false);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.stop).not.toHaveBeenCalled();
  });

  it("invalidates a stop waiting on inspection when activity arrives, without overlapping another stop", async () => {
    const gate = deferred<void>();
    let admitted = false;
    const f = fixture();
    f.stop.mockImplementationOnce(async (_target, allowed) => { await gate.promise; admitted = allowed(); return admitted ? "stopped" : "busy"; });
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.stop).toHaveBeenCalledOnce();
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.stop).toHaveBeenCalledOnce();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(admitted).toBe(false);
    expect(f.stopped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(f.stop).toHaveBeenCalledTimes(2);
    expect(f.stopped).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "close", "disable"])("revokes pending stop authority on %s and never rearms from a late result", async (action) => {
    const gate = deferred<void>();
    let allowed = true;
    const f = fixture();
    f.stop.mockImplementationOnce(async (_target, stillIdle) => { await gate.promise; allowed = stillIdle(); throw new Error("unreachable after inspection"); });
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(1_000);
    if (action === "cancel") f.manager.cancel(target);
    if (action === "close") f.manager.close();
    if (action === "disable") f.idle(0);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(allowed).toBe(false);
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.failed).not.toHaveBeenCalled();
    if (action === "close") { f.manager.activity(target); await vi.advanceTimersByTimeAsync(2_000); expect(f.stop).toHaveBeenCalledOnce(); }
  });

  it("pins replacement container identity and revokes an older pending stop", async () => {
    const gate = deferred<void>();
    let oldAllowed = true;
    const f = fixture();
    f.stop.mockImplementationOnce(async (_target, allowed) => { await gate.promise; oldAllowed = allowed(); return "gone"; });
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(1_000);
    const replacement = { ...target, containerId: "b".repeat(64) };
    f.manager.activity(replacement);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.stop).toHaveBeenCalledOnce();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(oldAllowed).toBe(false);
    expect(f.stop.mock.calls.map(([value]) => value.containerId)).toEqual([target.containerId, replacement.containerId]);
    expect(f.stopped).toHaveBeenCalledExactlyOnceWith(replacement);
  });

  it("backs unavailable daemons off and stops retrying after three failures until new activity", async () => {
    const f = fixture();
    f.stop.mockRejectedValue(new Error("Docker over SSH is unavailable"));
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.stop).toHaveBeenCalledTimes(3);
    expect(f.failed.mock.calls.map((call) => call[2])).toEqual([1_000, 2_000, null]);
    f.manager.observe(target);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.stop).toHaveBeenCalledTimes(3);
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.stop).toHaveBeenCalledTimes(4);
    expect(f.failed.mock.calls.at(-1)?.[2]).toBe(1_000);
    f.manager.close();
  });

  it("keeps an already stopped or missing computer stopped without another scheduled attempt", async () => {
    const f = fixture();
    f.stop.mockResolvedValue("gone");
    f.manager.activity(target);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.stopped).not.toHaveBeenCalled();
  });
});
