import { describe, expect, it } from "vitest";
import {
  autoScrollStep, clampLift, DRAG_SLOP, landingTop, pressStep, releaseMove, reorderShifts, reorderTarget, sameTarget, targetDrop, TOUCH_HOLD_MS,
  type ReorderSnapshot,
} from "./sidebar-reorder";

// Work: a 30px heading over dodo and echo; then unassigned: a heading over atlas, bea and cleo; then group chats.
// Rows are 54px with a 4px gap, so each row's pitch is 58.
const row = (id: string, list: string, top: number) => ({ id, list, top, height: 54 });
const snapshot: ReorderSnapshot = {
  gap: 4,
  rows: [row("dodo", "Work", 34), row("echo", "Work", 92), row("atlas", "", 190), row("bea", "", 248), row("cleo", "", 306)],
  zones: [
    { id: "work", list: "Work", top: 0, bottom: 146 },
    { id: "bots", list: "", top: 156, bottom: 360 },
    { id: "chats", list: null, top: 370, bottom: 430 },
  ],
};
const lists = new Map([["", ["atlas", "bea", "cleo"]], ["Work", ["dodo", "echo"]]]);
const shift = (botId: string, y: number) => reorderShifts(snapshot, botId, reorderTarget(snapshot, lists, botId, y));

describe("pressing a row", () => {
  it("lifts a mouse press only once it has moved a few pixels, so a click still opens the chat", () => {
    const press = { kind: "mouse" as const, x: 10, y: 10, at: 0 };
    expect(pressStep(press, 12, 12, 5000)).toBe("wait");
    expect(pressStep(press, 10, 10 + DRAG_SLOP, 1)).toBe("drag");
  });

  it("lifts a finger after a short hold, and lets one that moves first scroll the list", () => {
    const press = { kind: "touch" as const, x: 10, y: 10, at: 0 };
    expect(pressStep(press, 13, 10, 100)).toBe("wait");
    expect(pressStep(press, 10, 30, 100)).toBe("abandon");
    expect(pressStep(press, 10, 30, TOUCH_HOLD_MS)).toBe("drag");
  });
});

describe("where a dragged row goes", () => {
  it("counts the rows whose middle it has passed, at the places they had when it lifted", () => {
    expect(reorderTarget(snapshot, lists, "atlas", 217)).toEqual({ list: "", index: 0, folded: false });
    expect(reorderTarget(snapshot, lists, "atlas", 276)).toEqual({ list: "", index: 1, folded: false });
    expect(reorderTarget(snapshot, lists, "atlas", 340)).toEqual({ list: "", index: 2, folded: false });
    expect(reorderTarget(snapshot, lists, "cleo", 160)).toEqual({ list: "", index: 0, folded: false });
  });

  it("goes into another section, between its rows or under its heading", () => {
    expect(reorderTarget(snapshot, lists, "atlas", 100)).toEqual({ list: "Work", index: 1, folded: false });
    expect(reorderTarget(snapshot, lists, "atlas", 10)).toEqual({ list: "Work", index: 0, folded: false });
    expect(reorderTarget(snapshot, lists, "atlas", 151)).toEqual({ list: "Work", index: 2, folded: false });
  });

  it("goes nowhere over group chats, which take no bots", () => {
    expect(reorderTarget(snapshot, lists, "atlas", 400)).toBeNull();
    expect(releaseMove(lists, "atlas", reorderTarget(snapshot, lists, "atlas", 400), false)).toBeNull();
  });

  it("goes in at the end of a folded section", () => {
    const folded = { ...snapshot, zones: [...snapshot.zones, { id: "later", list: "Later", top: 440, bottom: 470 }] };
    const withLater = new Map([...lists, ["Later", ["zed"]]]);
    const target = reorderTarget(folded, withLater, "atlas", 455);
    expect(target).toEqual({ list: "Later", index: 0, folded: true });
    expect(targetDrop(withLater, "atlas", target!)).toEqual({ kind: "end", list: "Later" });
    expect(releaseMove(withLater, "atlas", target, false)).toEqual({ kind: "move", section: "Later", order: ["zed", "atlas"] });
    expect(reorderShifts(folded, "atlas", target)).toEqual({ rows: new Map(), zones: new Map() });
    expect(landingTop(folded, "atlas", target, reorderShifts(folded, "atlas", target))).toBeNull();
  });

  it("takes an empty department below its heading", () => {
    const empty = { ...snapshot, zones: [...snapshot.zones, { id: "new", list: "New", top: 440, bottom: 470 }] };
    const withNew = new Map([...lists, ["New", []]]);
    const target = reorderTarget(empty, withNew, "atlas", 460)!;
    expect(target).toEqual({ list: "New", index: 0, folded: false });
    expect(releaseMove(withNew, "atlas", target, false)).toEqual({ kind: "move", section: "New", order: ["atlas"] });
  });

  it("is the same target while the row moves within one gap", () => {
    expect(sameTarget(reorderTarget(snapshot, lists, "atlas", 280), reorderTarget(snapshot, lists, "atlas", 300))).toBe(true);
    expect(sameTarget(reorderTarget(snapshot, lists, "atlas", 270), reorderTarget(snapshot, lists, "atlas", 290))).toBe(false);
    expect(sameTarget(null, null)).toBe(true);
  });
});

describe("the rows making room", () => {
  it("slide up past a row dragged down its own list, and the row lands where the last of them was", () => {
    const shifts = shift("atlas", 340);
    expect(shifts.rows).toEqual(new Map([["bea", -58], ["cleo", -58]]));
    expect(shifts.zones.size).toBe(0);
    expect(landingTop(snapshot, "atlas", reorderTarget(snapshot, lists, "atlas", 340), shifts)).toBe(306);
  });

  it("slide down for a row dragged up, and nothing moves while it is still over its own place", () => {
    const shifts = shift("cleo", 217);
    expect(shifts.rows).toEqual(new Map([["atlas", 58], ["bea", 58]]));
    expect(landingTop(snapshot, "cleo", reorderTarget(snapshot, lists, "cleo", 217), shifts)).toBe(190);
    expect(shift("bea", 275).rows.size).toBe(0);
  });

  it("close the gap and open one in another section when the row goes up into it", () => {
    const target = reorderTarget(snapshot, lists, "bea", 100)!;
    const shifts = reorderShifts(snapshot, "bea", target);
    // echo makes room; unassigned's heading and atlas come down with it; cleo, past bea's old place, stays put
    expect(shifts.rows).toEqual(new Map([["echo", 58], ["cleo", -58]]));
    expect(shifts.zones).toEqual(new Map([["bots", 58]]));
    expect(landingTop(snapshot, "bea", target, shifts)).toBe(92);
  });

  it("move everything between up when the row goes down into a later section", () => {
    const moved = { ...snapshot, zones: [...snapshot.zones.slice(0, 2), { id: "chats", list: null, top: 370, bottom: 430 }, { id: "late", list: "Late", top: 440, bottom: 560 }],
      rows: [...snapshot.rows, row("fig", "Late", 474), row("gus", "Late", 532)] };
    const withLate = new Map([...lists, ["Late", ["fig", "gus"]]]);
    const target = reorderTarget(moved, withLate, "echo", 540)!;
    expect(target).toEqual({ list: "Late", index: 1, folded: false });
    const shifts = reorderShifts(moved, "echo", target);
    expect(shifts.zones).toEqual(new Map([["bots", -58], ["chats", -58], ["late", -58]]));
    // gus is past the gap: its section rises and it comes back down, so it stays where it was
    expect(shifts.rows).toEqual(new Map([["gus", 58]]));
    expect(landingTop(moved, "echo", target, shifts)).toBe(474);
    expect(releaseMove(withLate, "echo", target, false)).toEqual({ kind: "move", section: "Late", order: ["fig", "echo", "gus"] });
  });

  it("settle back with nothing moved when the drag is called off", () => {
    expect(reorderShifts(snapshot, "atlas", null)).toEqual({ rows: new Map(), zones: new Map() });
  });
});

describe("letting go", () => {
  it("saves the new order of the list the bot lands in", () => {
    expect(releaseMove(lists, "atlas", reorderTarget(snapshot, lists, "atlas", 340), false)).toEqual({ kind: "move", section: "", order: ["bea", "cleo", "atlas"] });
    expect(releaseMove(lists, "cleo", reorderTarget(snapshot, lists, "cleo", 217), false)).toEqual({ kind: "move", section: "", order: ["cleo", "atlas", "bea"] });
    expect(releaseMove(lists, "bea", reorderTarget(snapshot, lists, "bea", 100), false)).toEqual({ kind: "move", section: "Work", order: ["dodo", "bea", "echo"] });
  });

  it("changes nothing when dropped where it was, or after Escape", () => {
    expect(releaseMove(lists, "bea", reorderTarget(snapshot, lists, "bea", 275), false)).toBeNull();
    expect(releaseMove(lists, "atlas", reorderTarget(snapshot, lists, "atlas", 340), true)).toBeNull();
  });
});

describe("scrolling and bounds", () => {
  it("scrolls faster the nearer the pointer is to an edge, and not at all away from them", () => {
    expect(autoScrollStep(300, 0, 600)).toBe(0);
    expect(autoScrollStep(40, 0, 600)).toBeLessThan(0);
    expect(autoScrollStep(0, 0, 600)).toBeLessThan(autoScrollStep(40, 0, 600));
    expect(autoScrollStep(600, 0, 600)).toBe(14);
  });

  it("keeps the lifted row's centre within the sections, far enough down to pass the last row's middle", () => {
    expect(clampLift(-80, 54, snapshot.zones)).toBe(-27);
    expect(clampLift(900, 54, snapshot.zones)).toBe(430 - 27);
    expect(clampLift(200, 54, snapshot.zones)).toBe(200);
    const onlyBots = snapshot.zones.slice(0, 2);
    const lowest = clampLift(900, 54, onlyBots);
    expect(reorderTarget({ ...snapshot, zones: onlyBots }, lists, "atlas", lowest + 27)).toEqual({ list: "", index: 2, folded: false });
  });
});
