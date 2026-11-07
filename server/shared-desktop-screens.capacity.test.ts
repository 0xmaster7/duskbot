import { afterEach, describe, expect, it, vi } from "vitest";
import { createSharedScreenBroker, independentScreenTarget, isManagedScreenViewerPort, type ScreenContainer, type SharedScreenHooks } from "./shared-desktop-screens.ts";

const container: ScreenContainer = { sshAlias: "workspace-vps", ownerId: "computer_workspace", containerId: "a".repeat(64) };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra: Partial<SharedScreenHooks> = {}) {
  const hooks: SharedScreenHooks = { reset: vi.fn(async () => {}), start: vi.fn(async () => {}), stop: vi.fn(async () => {}), revoke: vi.fn(), ...extra };
  return { broker: createSharedScreenBroker(hooks), hooks };
}
afterEach(() => vi.useRealTimers());

describe("twenty on-demand bot screens", () => {
  it("defaults to twenty active displays while preparing at most two at once, then queues the twenty-first", async () => {
    let preparing = 0, peak = 0;
    const { broker, hooks } = fixture({ start: vi.fn(async () => { peak = Math.max(peak, ++preparing); await tick(); preparing -= 1; }) });
    const leases = await Promise.all(Array.from({ length: 20 }, (_, index) => broker.acquire(container, `bot-${index}`, { kind: "turn" })));
    expect(peak).toBe(2);
    expect(leases.map(lease => lease.target.display)).toEqual(Array.from({ length: 20 }, (_, index) => index + 2));
    let ready = false;
    const waiting = broker.acquire(container, "bot-20", { kind: "turn" }).then(lease => { ready = true; return lease; });
    await tick();
    expect(ready).toBe(false);
    expect(hooks.stop).not.toHaveBeenCalled();
    leases[0]!.release();
    const next = await waiting;
    expect(next.target.display).toBe(2);
    expect(next.target.generation).not.toBe(leases[0]!.target.generation);
    expect(next.target.chromiumProfile).not.toBe(leases[0]!.target.chromiumProfile);
    expect(leases.slice(1).every(lease => lease.live())).toBe(true);
    await broker.close();
  });
  it("preserves FIFO order after a queued request is cancelled", async () => {
    const { broker, hooks } = fixture({ maxScreens: () => 1 });
    const first = await broker.acquire(container, "first", { kind: "turn" });
    const second = broker.acquire(container, "second", { kind: "turn" });
    const abort = new AbortController();
    const cancelled = broker.acquire(container, "cancelled", { kind: "turn", signal: abort.signal });
    const third = broker.acquire(container, "third", { kind: "turn" });
    abort.abort(new Error("stopped"));
    await expect(cancelled).rejects.toThrow("stopped");
    first.release();
    const admitted = await second;
    expect(admitted.target.botId).toBe("second");
    admitted.release();
    expect((await third).target.botId).toBe("third");
    expect(vi.mocked(hooks.start).mock.calls.map(([, target]) => target.botId)).toEqual(["first", "second", "third"]);
    await broker.close();
  });
  it.each([0, 21, -1, 1.5])("rejects an invalid internal capacity %s before initialization", async maxScreens => {
    const { broker, hooks } = fixture({ maxScreens: () => maxScreens });
    await expect(broker.acquire(container, "bot", { kind: "turn" })).rejects.toMatchObject({ status: 500 });
    expect(hooks.reset).not.toHaveBeenCalled();
    await broker.close();
  });
  it("admits the twentieth canonical viewer/CDP target and refuses any port outside the managed range", () => {
    expect(independentScreenTarget("last-bot", 21)).toMatchObject({ display: 21, viewerPort: 6921, cdpPort: 9243, socket: "/run/user/1000/omb-screens/21/cua.sock" });
    expect(() => independentScreenTarget("outside", 22 as 21)).toThrow();
    for (const port of [6901, 6902, 6921]) expect(isManagedScreenViewerPort(port)).toBe(true);
    for (const port of [6900, 6922, 9243, 6902.5, NaN]) expect(isManagedScreenViewerPort(port)).toBe(false);
  });
});

describe("screen inactivity uses the existing computer idle preference", () => {
  it("rejects a queued same-bot retry when cleanup persistently fails without spinning microtasks", async () => {
    let fail = true;
    const stop = vi.fn(async () => { if (fail) throw new Error("screen cleanup unavailable"); });
    let limit = 2;
    const { broker } = fixture({ maxScreens: () => limit, stop });
    const first = await broker.acquire(container, "first", { kind: "turn" });
    const previous = await broker.acquire(container, "same", { kind: "watch" });
    limit = 1;
    broker.configure();
    const waiting = broker.acquire(container, "same", { kind: "turn" });
    await expect(waiting).rejects.toThrow("screen cleanup unavailable");
    await tick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(first.live()).toBe(true);
    expect(previous.live()).toBe(false);
    fail = false;
    await broker.close();
  });
  it("expires an inactive passive watcher and revokes it before stopping the guest session", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const { broker } = fixture({ idleTimeoutMs: () => 100, now: Date.now, revoke: () => { events.push("revoke"); }, stop: async () => { events.push("stop"); } });
    const watch = await broker.acquire(container, "watch", { kind: "watch" });
    await vi.advanceTimersByTimeAsync(100);
    expect(watch.live()).toBe(false);
    expect(events).toEqual(["revoke", "stop"]);
    await broker.close();
  });
  it("never expires a turn or human hold and starts the inactivity window when the final hard lease releases", async () => {
    vi.useFakeTimers();
    const { broker, hooks } = fixture({ idleTimeoutMs: () => 100, now: Date.now });
    const turn = await broker.acquire(container, "turn", { kind: "turn" });
    const hold = await broker.acquire(container, "hold", { kind: "hold" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(hooks.stop).not.toHaveBeenCalled();
    expect(turn.live() && hold.live()).toBe(true);
    turn.release();
    await vi.advanceTimersByTimeAsync(99);
    expect(hooks.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(hooks.stop).toHaveBeenCalledTimes(1);
    expect(hold.live()).toBe(true);
    hold.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(hooks.stop).toHaveBeenCalledTimes(2);
    await broker.close();
  });
  it("renews only for real lease activity and leaves status checks unable to extend screen lifetime", async () => {
    vi.useFakeTimers();
    const { broker } = fixture({ idleTimeoutMs: () => 100, now: Date.now });
    const watch = await broker.acquire(container, "watch", { kind: "watch" });
    await vi.advanceTimersByTimeAsync(75);
    watch.touch();
    await vi.advanceTimersByTimeAsync(99);
    for (let count = 0; count < 20; count += 1) broker.busy(container);
    expect(watch.live()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(watch.live()).toBe(false);
    await broker.close();
  });
  it("reschedules existing timers when preferences change without granting a new activity window", async () => {
    vi.useFakeTimers();
    let timeout = 1000;
    const { broker } = fixture({ idleTimeoutMs: () => timeout, now: Date.now });
    const watch = await broker.acquire(container, "watch", { kind: "watch" });
    await vi.advanceTimersByTimeAsync(100);
    timeout = 200;
    broker.configure();
    await vi.advanceTimersByTimeAsync(100);
    expect(watch.live()).toBe(false);
    await broker.close();
  });
  it("keeps idle stopping disabled when the preference is zero", async () => {
    vi.useFakeTimers();
    const { broker, hooks } = fixture({ idleTimeoutMs: () => 0, now: Date.now });
    const watch = await broker.acquire(container, "watch", { kind: "watch" });
    await vi.advanceTimersByTimeAsync(1000000);
    broker.configure();
    expect(watch.live()).toBe(true);
    expect(hooks.stop).not.toHaveBeenCalled();
    await broker.close();
  });
  it("shrinks capacity by retiring passive screens while preserving any active holder until release", async () => {
    let limit = 3;
    const { broker } = fixture({ maxScreens: () => limit });
    const first = await broker.acquire(container, "first", { kind: "watch" });
    const hold = await broker.acquire(container, "hold", { kind: "hold" });
    const last = await broker.acquire(container, "last", { kind: "watch" });
    limit = 1;
    broker.configure();
    await tick();
    expect(first.live()).toBe(true);
    expect(last.live()).toBe(false);
    expect(hold.live()).toBe(true);
    hold.release();
    await tick();
    expect(hold.live()).toBe(false);
    await broker.close();
  });
  it("reports failed idle cleanup and retries that exact old generation before assigning another bot", async () => {
    vi.useFakeTimers();
    const stop = vi.fn<SharedScreenHooks["stop"]>().mockRejectedValueOnce(new Error("temporary disconnect")).mockResolvedValue(undefined);
    const error = vi.fn();
    const { broker } = fixture({ maxScreens: () => 1, idleTimeoutMs: () => 100, now: Date.now, stop, onError: error });
    const old = await broker.acquire(container, "old", { kind: "watch" });
    await vi.advanceTimersByTimeAsync(100);
    expect(error).toHaveBeenCalledOnce();
    expect(old.live()).toBe(false);
    const next = await broker.acquire(container, "new", { kind: "turn" });
    expect(stop.mock.calls[1]![1].generation).toBe(old.target.generation);
    expect(next.live()).toBe(true);
    await broker.close();
  });
  it("does not reopen a bot profile on another display while its old generation is still stopping", async () => {
    let limit = 3;
    let finishStop!: () => void;
    const stopping = new Promise<void>(resolve => { finishStop = resolve; });
    const start = vi.fn<SharedScreenHooks["start"]>().mockResolvedValue(undefined);
    const { broker } = fixture({ maxScreens: () => limit, start,
      stop: async (_container, target) => { if (target.botId === "moving" && target.display === 4) await stopping; },
    });
    await broker.acquire(container, "passive", { kind: "watch" });
    await broker.acquire(container, "held", { kind: "hold" });
    const old = await broker.acquire(container, "moving", { kind: "hold" });
    limit = 1;
    broker.configure();
    old.release();
    const pending = broker.acquire(container, "moving", { kind: "turn" });
    await tick();
    expect(start.mock.calls.filter(([, target]) => target.botId === "moving")).toHaveLength(1);
    finishStop();
    const next = await pending;
    expect(next.target.display).toBe(2);
    expect(next.target.chromiumProfile).toBe(old.target.chromiumProfile);
    expect(next.target.generation).not.toBe(old.target.generation);
    await broker.close();
  });

  it("retires a cancelled warmup as soon as it completes instead of retaining an unused screen until idle expiry", async () => {
    let finishStart!: () => void;
    const starting = new Promise<void>(resolve => { finishStart = resolve; });
    const { broker, hooks } = fixture({ idleTimeoutMs: () => 600000, start: async () => starting });
    const abort = new AbortController();
    const request = broker.acquire(container, "cancelled", { kind: "turn", signal: abort.signal });
    await tick();
    abort.abort(new Error("stopped"));
    await expect(request).rejects.toThrow("stopped");
    expect(hooks.stop).not.toHaveBeenCalled();
    finishStart();
    await tick();
    expect(hooks.stop).toHaveBeenCalledOnce();
    expect(broker.busy(container)).toBe(false);
    await broker.close();
  });
  it("retains a shared warmup when one cancelled request still has another same-bot consumer", async () => {
    let finishStart!: () => void;
    const starting = new Promise<void>(resolve => { finishStart = resolve; });
    const { broker, hooks } = fixture({ start: async () => starting });
    const abort = new AbortController();
    const cancelled = broker.acquire(container, "same", { kind: "turn", signal: abort.signal });
    const retained = broker.acquire(container, "same", { kind: "turn" });
    abort.abort(new Error("stopped"));
    await expect(cancelled).rejects.toThrow("stopped");
    finishStart();
    expect((await retained).live()).toBe(true);
    expect(hooks.stop).not.toHaveBeenCalled();
    await broker.close();
  });

});
