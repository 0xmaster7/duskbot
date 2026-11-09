import { describe, expect, it } from "vitest";
import { busyBotNames, quitHintText, stopActions } from "./DesktopBots";

describe("the ⌘Q pill", () => {
  it("names only the working bots the sidebar lists", () => {
    expect(busyBotNames([
      { name: "Scout", busy: true },
      { name: "Echo", busy: false },
      { name: "Ghost", busy: true, hidden: true },
      { name: "Moved", busy: true, movedTo: { kind: "cloud" } as never },
    ])).toEqual(["Scout"]);
  });

  it("names one, a few, or counts many, with the platform's key", () => {
    expect(quitHintText(["Scout"], true, "en")).toBe("Scout is working. Hold ⌘Q to quit.");
    expect(quitHintText(["Scout", "Echo"], false, "en")).toBe("Scout and Echo are working. Hold Ctrl+Q to quit.");
    expect(quitHintText(["A", "B", "C", "D"], true, "en")).toBe("4 bots are working. Hold ⌘Q to quit.");
  });
});

describe("Stop Bot and Stop All Bots", () => {
  const bots = [
    { id: "scout", name: "Scout", threadId: "s1", busy: true, tasks: [{ threadId: "s1", busy: false }, { threadId: "s2", busy: true }, { threadId: "s3", busy: true }] },
    { id: "echo", name: "Echo", threadId: "e1", busy: true },
    { id: "idle", name: "Idle", threadId: "i1", busy: false },
  ];
  const groups = [
    { id: "room", threadId: "r1", working: true },
    { id: "quiet", threadId: "q1", working: false, busyBotId: null },
  ];
  const state = (selectedId: string) => ({ bots, groups, selectedId }) as never;

  it("⌘. stops the open chat's running turn, and nothing when it has none", () => {
    expect(stopActions(state("echo"), false)).toEqual([{ type: "interrupt", botId: "echo", threadId: "e1" }]);
    expect(stopActions(state("scout"), false)).toEqual([{ type: "interrupt", botId: "scout", threadId: "s2" }]);
    expect(stopActions(state("room"), false)).toEqual([{ type: "interruptGroup", groupId: "room", threadId: "r1" }]);
    expect(stopActions(state("idle"), false)).toEqual([]);
    expect(stopActions(state("quiet"), false)).toEqual([]);
  });

  it("⌥⌘. stops every running turn: each busy chat of each bot, and each working room", () => {
    expect(stopActions(state("idle"), true)).toEqual([
      { type: "interrupt", botId: "scout", threadId: "s2" },
      { type: "interrupt", botId: "scout", threadId: "s3" },
      { type: "interrupt", botId: "echo", threadId: "e1" },
      { type: "interruptGroup", groupId: "room", threadId: "r1" },
    ]);
  });
});
