import { describe, expect, it } from "vitest";
import { roomRowLayout, type RoomSlot } from "./room-row-layout";

const you: RoomSlot = { group: "user:", sender: null, stamped: false };
const said = (bot: string, extra: Partial<RoomSlot> = {}): RoomSlot => ({ group: `bot:${bot}`, sender: bot, stamped: false, ...extra });
const card = (bot: string): RoomSlot => ({ group: null, sender: bot, stamped: false });

describe("a room's rows, as a group chat lays them out", () => {
  it("names a bot once at the start of its run and joins its consecutive bubbles", () => {
    const places = roomRowLayout([you, said("nova"), said("nova"), said("rivet"), you, you]);
    expect(places.map((place) => place.label)).toEqual([false, true, false, true, false, false]);
    expect(places.map((place) => place.join)).toEqual([
      { above: false, below: false },
      { above: false, below: true },
      { above: true, below: false },
      { above: false, below: false },
      { above: false, below: true },
      { above: true, below: false },
    ]);
  });

  it("reads past rows that draw nothing, and starts over after a stamp", () => {
    const places = roomRowLayout([said("nova"), null, said("nova"), said("nova", { stamped: true })]);
    expect(places[0]!.join.below).toBe(true);
    expect(places[2]!.join).toEqual({ above: true, below: false });
    expect(places[3]!.label).toBe(true);
    expect(places[3]!.join.above).toBe(false);
  });

  it("tucks a bot's card under its own bubble without naming it again", () => {
    const places = roomRowLayout([said("nova"), card("nova"), card("rivet")]);
    expect(places[1]).toEqual({ join: { above: false, below: false }, label: false, tuck: true });
    expect(places[2]!.label).toBe(true);
    expect(places[2]!.tuck).toBe(false);
  });
});
