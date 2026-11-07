import { describe, expect, it, vi } from "vitest";
import { createSharedScreenBroker, independentScreenExecArgs, independentScreenTarget, type ScreenContainer, type SharedScreenHooks } from "./shared-desktop-screens.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const container: ScreenContainer = { sshAlias: "workspace-vps", ownerId: "computer_workspace", containerId: "a".repeat(64) };
function fixture(extra: Partial<SharedScreenHooks> = {}) {
  const events: string[] = [];
  let time = 0;
  const hooks: SharedScreenHooks = {
    reset: vi.fn(async () => { events.push("reset"); }),
    start: vi.fn(async (_container, target) => { events.push(`start:${target.botId}:${target.display}`); }),
    stop: vi.fn(async (_container, target) => { events.push(`stop:${target.botId}:${target.display}`); }),
    revoke: vi.fn((_container, target) => { events.push(`revoke:${target.botId}:${target.display}`); }),
    now: () => ++time,
    ...extra,
  };
  return { broker: createSharedScreenBroker(hooks), hooks, events };
}

describe("independent shared-computer screen targets", () => {
  it("derives bounded ports, sockets and separate persistent profiles from a validated bot identity", () => {
    const a = independentScreenTarget("bot-a", 2, "11111111-1111-4111-8111-111111111111");
    const b = independentScreenTarget("bot-b", 3, "22222222-2222-4222-8222-222222222222");
    expect(a).toMatchObject({ viewerPort: 6902, cdpPort: 9224, socket: "/run/user/1000/omb-screens/2/cua.sock" });
    expect(a.chromiumProfile).not.toBe(b.chromiumProfile);
    expect(independentScreenTarget("bot-a", 5).chromiumProfile).toBe(a.chromiumProfile);
    expect(independentScreenExecArgs(container.containerId, "ensure", a)).toEqual(["exec", "-u", "cua", container.containerId, "/usr/local/bin/omb-screen", "ensure", "2", a.botHash, "11111111-1111-4111-8111-111111111111"]);
    expect(independentScreenExecArgs(container.containerId, "reset")).toEqual(["exec", "-u", "cua", container.containerId, "/usr/local/bin/omb-screen", "reset"]);
    expect(Object.isFrozen(a)).toBe(true);
  });
  it.each(["../foreign", "a/b", "bot;reboot", "bot\nother", "", "a".repeat(161)])("refuses an unsafe bot identity %j", botId => {
    expect(() => independentScreenTarget(botId, 2)).toThrow(/Invalid/);
  });
  it("rejects forged paths, generations, displays and container references", () => {
    const target = independentScreenTarget("bot-a", 2);
    expect(() => independentScreenExecArgs("short-id", "ensure", target)).toThrow();
    expect(() => independentScreenExecArgs(container.containerId, "ensure", { ...target, socket: "/other/socket" })).toThrow();
    expect(() => independentScreenTarget("bot-a", 1 as 2)).toThrow();
    expect(() => independentScreenTarget("bot-a", 2, "bad/generation")).toThrow();
  });
});

describe("four-screen shared-computer broker", () => {
  it("starts different bot screens concurrently after one reset, queues a fifth active bot, and admits it after release", async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const { broker, hooks } = fixture({ start: vi.fn(async (_container, target) => {
      const gate = deferred(); gates.set(target.botId, gate); await gate.promise;
    }) });
    const first = ["one", "two", "three", "four"].map(bot => broker.acquire(container, bot, { kind: "turn" }));
    let fifthReady = false;
    const fifth = broker.acquire(container, "five", { kind: "turn" }).then(lease => { fifthReady = true; return lease; });
    await tick();
    expect(hooks.reset).toHaveBeenCalledTimes(1);
    expect([...gates.keys()]).toEqual(["one", "two", "three", "four"]);
    for (const gate of gates.values()) gate.resolve();
    const leases = await Promise.all(first);
    expect(new Set(leases.map(lease => lease.target.display)).size).toBe(4);
    expect(fifthReady).toBe(false);
    leases[0]!.release();
    await tick();
    gates.get("five")!.resolve();
    const next = await fifth;
    expect(next.live()).toBe(true);
    expect(next.target.display).toBe(leases[0]!.target.display);
    expect(leases[0]!.live()).toBe(false);
    expect(leases.slice(1).every(lease => lease.live())).toBe(true);
    await broker.close();
  });
  it("keeps one profile and screen for parallel turns of the same bot until both release", async () => {
    const { broker, hooks } = fixture();
    const [first, second] = await Promise.all([broker.acquire(container, "same-bot", { kind: "turn" }), broker.acquire(container, "same-bot", { kind: "turn" })]);
    expect(hooks.start).toHaveBeenCalledTimes(1);
    expect(first.target).toEqual(second.target);
    first.release();
    expect(first.live()).toBe(false);
    expect(second.live()).toBe(true);
    expect(broker.busy(container)).toBe(true);
    second.release();
    expect(broker.busy(container)).toBe(false);
    await broker.close();
  });
  it("reclaims passive watch screens only after revoking old viewers and stopping the old guest session", async () => {
    const { broker, events } = fixture();
    const watches = await Promise.all(["one", "two", "three", "four"].map(bot => broker.acquire(container, bot, { kind: "watch" })));
    expect(broker.busy(container)).toBe(false);
    const next = await broker.acquire(container, "five", { kind: "turn" });
    expect(events.slice(-3)).toEqual([`revoke:one:${watches[0]!.target.display}`, `stop:one:${watches[0]!.target.display}`, `start:five:${next.target.display}`]);
    expect(watches[0]!.live()).toBe(false);
    expect(watches.slice(1).every(lease => lease.live())).toBe(true);
    expect(broker.busy(container)).toBe(true);
    await broker.close();
  });
  it("does not preempt any active turn or human hold, and cancellation frees the queue request", async () => {
    const { broker, hooks } = fixture();
    const holds = await Promise.all(["one", "two", "three", "four"].map(bot => broker.acquire(container, bot, { kind: "hold" })));
    const abort = new AbortController();
    const queued = broker.acquire(container, "five", { kind: "turn", signal: abort.signal });
    abort.abort(new Error("stopped"));
    await expect(queued).rejects.toThrow("stopped");
    expect(holds.every(lease => lease.live())).toBe(true);
    expect(hooks.stop).not.toHaveBeenCalled();
    await broker.close();
  });
  it("supports more than four configured bots while retaining their profile identity across slot reclamation", async () => {
    const { broker, hooks } = fixture();
    const profiles = new Map<string, string>();
    for (const bot of ["one", "two", "three", "four", "five", "six", "seven", "eight", "one"]) {
      const lease = await broker.acquire(container, bot, { kind: "turn" });
      if (profiles.has(bot)) expect(lease.target.chromiumProfile).toBe(profiles.get(bot));
      profiles.set(bot, lease.target.chromiumProfile);
      lease.release();
    }
    expect(profiles.size).toBe(8);
    expect(hooks.reset).toHaveBeenCalledTimes(1);
    await broker.close();
  });
  it("does not start a screen for a cancelled request waiting on initialization", async () => {
    const reset = deferred();
    const { broker, hooks } = fixture({ reset: async () => reset.promise });
    const abort = new AbortController();
    const queued = broker.acquire(container, "one", { kind: "turn", signal: abort.signal });
    abort.abort(new Error("stopped"));
    await expect(queued).rejects.toThrow("stopped");
    reset.resolve();
    await tick();
    expect(hooks.start).not.toHaveBeenCalled();
    await broker.close();
  });
  it("cleans up a failed partial start before retrying and surfaces unsupported image errors", async () => {
    let fail = true;
    const { broker, events } = fixture({ start: async (_container, target) => {
      events.push(`start:${target.botId}:${target.display}`);
      if (fail) { fail = false; throw new Error("Update the bot desktop image to use independent screens"); }
    } });
    await expect(broker.acquire(container, "one", { kind: "turn" })).rejects.toThrow(/Update/);
    const next = await broker.acquire(container, "one", { kind: "turn" });
    expect(events.slice(-3)).toEqual(["revoke:one:2", "stop:one:2", "start:one:2"]);
    expect(next.live()).toBe(true);
    await broker.close();
  });
  it("keeps container snapshots immutable and refuses another owner for the same physical container", async () => {
    const { broker } = fixture();
    const first = await broker.acquire(container, "one", { kind: "turn" });
    await expect(broker.acquire({ ...container, ownerId: "foreign-owner" }, "other", { kind: "turn" })).rejects.toMatchObject({ status: 403 });
    expect(first.live()).toBe(true);
    await broker.close();
  });
  it("revokes every lease on close, cancels queued requests, and resets before a later container reuse", async () => {
    const { broker, hooks } = fixture();
    const leases = await Promise.all(["one", "two", "three", "four"].map(bot => broker.acquire(container, bot, { kind: "turn" })));
    const waiting = broker.acquire(container, "five", { kind: "turn" });
    const refused = expect(waiting).rejects.toMatchObject({ status: 503 });
    await Promise.all([broker.closeContainer(container), broker.closeContainer(container)]);
    await refused;
    expect(leases.every(lease => !lease.live())).toBe(true);
    expect(hooks.stop).toHaveBeenCalledTimes(4);
    const next = await broker.acquire(container, "one", { kind: "turn" });
    expect(next.target.generation).not.toBe(leases[0]!.target.generation);
    expect(hooks.reset).toHaveBeenCalledTimes(2);
    await broker.close();
  });
  it("waits for a late start before stopping its generation on container close", async () => {
    const started = deferred(), finishStart = deferred();
    let stopped = false;
    const { broker } = fixture({
      start: async () => { started.resolve(); await finishStart.promise; },
      stop: async () => { stopped = true; },
    });
    const request = broker.acquire(container, "one", { kind: "turn" });
    const refused = expect(request).rejects.toMatchObject({ status: 503 });
    await started.promise;
    let closed = false;
    const closing = broker.closeContainer(container).then(() => { closed = true; });
    await tick();
    expect(closed).toBe(false);
    expect(stopped).toBe(false);
    await expect(broker.acquire(container, "other", { kind: "watch" })).rejects.toMatchObject({ status: 503 });
    finishStart.resolve();
    await closing;
    await refused;
    expect(stopped).toBe(true);
    await broker.close();
  });
  it("bounds pending requests while four humans hold every screen", async () => {
    const { broker } = fixture();
    await Promise.all(["one", "two", "three", "four"].map(bot => broker.acquire(container, bot, { kind: "hold" })));
    const waiting = Array.from({ length: 256 }, (_, index) => broker.acquire(container, `waiting-${index}`, { kind: "turn" }).catch(error => error));
    await expect(broker.acquire(container, "one-too-many", { kind: "turn" })).rejects.toMatchObject({ status: 429 });
    await broker.close();
    expect((await Promise.all(waiting)).every(error => error.status === 503)).toBe(true);
  });

});
