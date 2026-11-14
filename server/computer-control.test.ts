import { describe, expect, it } from "vitest";

import { COMPUTER_CONTROL_HEARTBEAT_MS } from "../shared/wire.ts";
import { CONTROL_SILENCE_MS, CONTROL_SILENCE_SWEEP_MS, ComputerControl, type ControlSnapshot } from "./computer-control.ts";

function tracked() {
  const changes: Array<{ botId: string; snapshot: ControlSnapshot }> = [];
  const control = new ComputerControl((botId, snapshot) => changes.push({ botId, snapshot }));
  return { control, changes };
}

describe("computer control", () => {
  it("starts disengaged for an unknown bot", () => {
    const { control } = tracked();
    expect(control.snapshot("b1")).toEqual({ held: false, helpReason: null, heldSinceMs: null });
  });

  it("take → held; release → disengaged, each broadcast once", () => {
    const { control, changes } = tracked();
    const held = control.take("b1");
    expect(held.held).toBe(true);
    expect(held.heldSinceMs).not.toBeNull();
    expect(control.release("b1").held).toBe(false);
    expect(changes.map((c) => c.snapshot.held)).toEqual([true, false]);
  });

  it("a second take does not reset how long the hold has lasted", () => {
    let clock = 1000;
    const control = new ComputerControl(() => {}, () => clock);
    control.take("b1");
    clock = 5000;
    expect(control.take("b1").heldSinceMs).toBe(1000);
  });

  it("atomically acquires a workspace lease without exposing its id", () => {
    const { control, changes } = tracked();
    const leaseId = "5b6bbbd2-b88b-4c50-a748-ec87f332662f";
    const acquired = control.acquireLease("b1", leaseId);
    expect(acquired).toMatchObject({ owned: true, acquired: true, snapshot: { held: true } });
    expect(acquired.snapshot).not.toHaveProperty("controlLeaseId");
    expect(JSON.stringify(changes)).not.toContain(leaseId);

    const sameLease = control.acquireLease("b1", leaseId);
    expect(sameLease).toMatchObject({ owned: true, acquired: false });
    expect(changes).toHaveLength(1);
  });

  it("does not acquire or release a hold owned by another surface", () => {
    const { control, changes } = tracked();
    control.take("b1");
    const leaseId = "57c7f3ef-e41d-4adf-bbda-0bd25bb03893";

    expect(control.acquireLease("b1", leaseId)).toMatchObject({
      owned: false,
      acquired: false,
      snapshot: { held: true },
    });
    expect(control.releaseLease("b1", leaseId)).toMatchObject({
      released: false,
      snapshot: { held: true },
    });
    expect(changes.map((change) => change.snapshot.held)).toEqual([true]);
  });

  it("conditionally releases only the matching workspace lease", () => {
    const { control, changes } = tracked();
    const owner = "33e62f3a-89d9-4117-b48a-15f7deae3252";
    const other = "ed602995-306f-480a-8817-e8d8c8fe7d90";
    control.acquireLease("b1", owner);

    expect(control.releaseLease("b1", other).released).toBe(false);
    expect(control.snapshot("b1").held).toBe(true);
    expect(control.releaseLease("b1", owner)).toMatchObject({
      released: true,
      snapshot: { held: false },
    });
    expect(changes.map((change) => change.snapshot.held)).toEqual([true, false]);
  });

  const ref = (messageId: string, site = "example.com") => ({ botId: "b1", threadId: "t1", messageId, site, place: "browser" as const });

  it("requestHelp surfaces the plea and its card but never grants control", () => {
    const { control } = tracked();
    const snapshot = control.requestHelp("b1", "  sign in to example.com  ", ref("card-1"));
    expect(snapshot.held).toBe(false);
    expect(snapshot.helpReason).toBe("sign in to example.com");
    expect(snapshot.help).toEqual(ref("card-1"));
  });

  it("an empty reason still names the site", () => {
    const { control } = tracked();
    expect(control.requestHelp("b1", undefined, ref("card-1", "mail.example")).helpReason).toBe("sign in to mail.example");
  });

  it("shows the newest plea, and the older one again once the newer settles", () => {
    const { control } = tracked();
    control.requestHelp("b1", "first", ref("card-1"));
    expect(control.requestHelp("b1", "second", ref("card-2", "other.example")).help?.messageId).toBe("card-2");
    expect(control.settleHelp("card-2")).toEqual(["b1"]);
    expect(control.snapshot("b1")).toMatchObject({ helpReason: "first", help: { messageId: "card-1" } });
  });

  it("settles only the card it names, wherever it was raised", () => {
    const { control, changes } = tracked();
    control.requestHelp("b1", "first", ref("card-1"));
    expect(control.settleHelp("some-other-card")).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(control.settleHelp("card-1")).toEqual(["b1"]);
    expect(control.snapshot("b1")).toEqual({ held: false, helpReason: null, heldSinceMs: null });
    expect(changes).toHaveLength(2);
  });

  it("a novel-length reason is cut to card size", () => {
    const { control } = tracked();
    const reason = "x".repeat(2000);
    expect(control.requestHelp("b1", reason, ref("card-1")).helpReason?.length).toBe(280);
  });

  it("handing back mid-way keeps the plea: only the card settles it", () => {
    const { control } = tracked();
    control.requestHelp("b1", "sign in to example.com", ref("card-1"));
    control.take("b1");
    const after = control.release("b1");
    expect(after).toMatchObject({ held: false, helpReason: "sign in to example.com", help: { messageId: "card-1" } });
    control.settleHelp("card-1");
    expect(control.snapshot("b1")).toEqual({ held: false, helpReason: null, heldSinceMs: null });
  });

  it("settling a plea while driving keeps the hold", () => {
    const { control } = tracked();
    control.take("b1");
    control.requestHelp("b1", "also this", ref("card-1"));
    control.settleHelp("card-1");
    expect(control.snapshot("b1")).toMatchObject({ held: true, helpReason: null });
  });

  it("bots are independent", () => {
    const { control } = tracked();
    control.take("b1");
    expect(control.snapshot("b2").held).toBe(false);
  });

  it("forget clears a hold and tells the listeners", () => {
    const { control, changes } = tracked();
    control.take("b1");
    control.forget("b1");
    expect(control.snapshot("b1").held).toBe(false);
    expect(changes.at(-1)?.snapshot).toEqual({ held: false, helpReason: null, heldSinceMs: null });
  });

  it("forgetting an unknown bot is silent", () => {
    const { control, changes } = tracked();
    control.forget("ghost");
    expect(changes).toEqual([]);
  });

  it("reports whether a lease holds the computer without taking a free one", () => {
    const control = new ComputerControl();
    expect(control.ownsLease("bot", "lease-aaaaaaaaaaaaaa")).toBe(false);
    expect(control.snapshot("bot").held).toBe(false);
    control.acquireLease("bot", "lease-aaaaaaaaaaaaaa");
    expect(control.ownsLease("bot", "lease-aaaaaaaaaaaaaa")).toBe(true);
    expect(control.ownsLease("bot", "lease-bbbbbbbbbbbbbb")).toBe(false);
    control.release("bot");
    expect(control.ownsLease("bot", "lease-aaaaaaaaaaaaaa")).toBe(false);
  });

  it("keeps the computer awake while a card waits for the person, up to the hold, and not once it is answered", () => {
    let now = 1_000;
    const control = new ComputerControl(() => {}, () => now);
    expect(control.pleaHolds("b1", 60_000)).toBe(false);
    control.requestHelp("b1", "sign in to example.com", ref("card-1"));
    now += 59_000;
    expect(control.pleaHolds("b1", 60_000)).toBe(true);
    now += 2_000;
    expect(control.pleaHolds("b1", 60_000)).toBe(false);
    control.requestHelp("b1", "sign in to example.com", ref("card-2"));
    expect(control.pleaHolds("b1", 60_000)).toBe(true);
    control.settleHelp("card-2");
    expect(control.pleaHolds("b1", 60_000)).toBe(false);
  });

  describe("a lease hold that goes silent", () => {
    const lease = "5b6bbbd2-b88b-4c50-a748-ec87f332662f";
    const clocked = () => {
      let clock = 0;
      const changes: ControlSnapshot[] = [];
      const control = new ComputerControl((_, snapshot) => changes.push(snapshot), () => clock);
      return { control, changes, at: (ms: number) => { clock = ms; }, now: () => clock };
    };

    it("stays held while its holder keeps heartbeating, even at a throttled once-a-minute pace", () => {
      const { control, at } = clocked();
      control.acquireLease("b1", lease);
      const beats = [
        ...Array.from({ length: 15 }, (_, i) => (i + 1) * COMPUTER_CONTROL_HEARTBEAT_MS),
        ...Array.from({ length: 10 }, (_, i) => 300_000 + (i + 1) * 60_000 + 3_000),
      ];
      let beat = 0;
      for (let t = 0; t <= beats.at(-1)!; t += 1_000) {
        at(t);
        if (t === beats[beat]) { expect(control.heard("b1", lease)).toBe(true); beat += 1; }
        if (t % CONTROL_SILENCE_SWEEP_MS === 0) expect(control.releaseSilent(CONTROL_SILENCE_MS)).toEqual([]);
      }
      expect(control.ownsLease("b1", lease)).toBe(true);
    });

    it("is handed back within 60 to 75 s of the last heartbeat, as a hand-back would be", () => {
      const { control, changes, at, now } = clocked();
      control.acquireLease("b1", lease);
      at(40_000);
      control.heard("b1", lease);
      let released: string[] = [];
      while (!released.length) {
        at(now() + CONTROL_SILENCE_SWEEP_MS);
        released = control.releaseSilent(CONTROL_SILENCE_MS);
      }
      expect(released).toEqual(["b1"]);
      expect(now() - 40_000).toBeGreaterThanOrEqual(60_000);
      expect(now() - 40_000).toBeLessThanOrEqual(75_000);
      expect(control.snapshot("b1")).toEqual({ held: false, helpReason: null, heldSinceMs: null });
      expect(changes.map((snapshot) => snapshot.held)).toEqual([true, false]);
      expect(control.heard("b1", lease)).toBe(false);
    });

    it("keeps an open sign-in plea, and never touches a plain take or another lease's heartbeat", () => {
      const { control, at } = clocked();
      control.requestHelp("b1", "sign in", { botId: "b1", threadId: "t1", messageId: "card-1", site: "example.com", place: "vm" });
      control.acquireLease("b1", lease);
      control.take("b2");
      control.acquireLease("b3", "another-lease-0000000");
      at(CONTROL_SILENCE_MS - 1);
      expect(control.heard("b3", lease)).toBe(false);
      expect(control.heard("b3", "another-lease-0000000")).toBe(true);
      at(CONTROL_SILENCE_MS);
      expect(control.releaseSilent(CONTROL_SILENCE_MS)).toEqual(["b1"]);
      expect(control.snapshot("b1")).toMatchObject({ held: false, helpReason: "sign in" });
      at(10 * CONTROL_SILENCE_MS);
      expect(control.releaseSilent(CONTROL_SILENCE_MS)).toEqual(["b3"]);
      expect(control.snapshot("b2").held).toBe(true);
    });
  });
});
