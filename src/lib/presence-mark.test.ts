import { describe, expect, it } from "vitest";

import { heldPresence, PRESENCE_HOLD_MS, presenceKind, turnWorked, TYPING_MARK, workingMark, type PresenceKind } from "./presence-mark";
import type { Message } from "@/state/store";

const row = (id: string, extra: Partial<Message>): Message => ({ id, role: "bot", kind: "text", text: "", at: 1, ...extra } as Message);
const tool = (id: string) => row(id, { kind: "activity", tool: { name: "Bash", ok: true } } as Partial<Message>);

describe("what a running turn's mark shows", () => {
  it("is at work, never typing, while a tool runs", () => {
    expect(presenceKind({ writing: false, activity: "command", worked: false })).toBe("working");
    expect(presenceKind({ writing: false, activity: "web", worked: true })).toBe("working");
    expect(workingMark("command")).toBe("running");
    expect(workingMark("read")).toBe("reading");
  });

  it("types only while the reply's words stream", () => {
    expect(presenceKind({ writing: true, activity: "command", worked: true })).toBe("typing");
    expect(presenceKind({ writing: false, activity: "reply", worked: true })).toBe("typing");
    expect(TYPING_MARK, "grok types as the bot itself; the dots only open a turn").toBe("streaming");
  });

  it("stays at work in the gap between two tools", () => {
    expect(presenceKind({ writing: false, activity: "thinking", worked: true })).toBe("working");
    expect(presenceKind({ writing: false, activity: null, worked: true })).toBe("working");
    // the mascot at work, never the dots (the mark's thinking state)
    expect(workingMark("thinking")).toBe("working");
    expect(workingMark(null)).toBe("working");
    expect(workingMark("thinking")).not.toBe(TYPING_MARK);
  });

  it("waits quietly before a turn has done anything", () => {
    expect(presenceKind({ writing: false, activity: "thinking", worked: false })).toBe("waiting");
    expect(presenceKind({ writing: false, activity: undefined, worked: false })).toBe("waiting");
  });

  it("knows a turn worked from a tool row after the person's newest message", () => {
    expect(turnWorked([row("u", { role: "user" }), tool("t"), row("b", {})])).toBe(true);
    expect(turnWorked([tool("t"), row("u", { role: "user" })])).toBe(false);
    expect(turnWorked([])).toBe(false);
  });
});

describe("holding a state", () => {
  const start = { kind: "working" as PresenceKind | null, since: 1_000 };

  it("never flickers to typing and back on a short gap", () => {
    const flick = heldPresence(start, "typing", 1_000 + 200);
    expect(flick.kind).toBe("working");
    expect(heldPresence(flick, "working", 1_000 + 300).kind).toBe("working");
  });

  it("takes the new state once the shown one has held its time", () => {
    const later = heldPresence(start, "typing", 1_000 + PRESENCE_HOLD_MS);
    expect(later).toEqual({ kind: "typing", since: 1_000 + PRESENCE_HOLD_MS });
  });

  it("never holds back a turn starting or ending", () => {
    expect(heldPresence({ kind: null, since: 1_000 }, "working", 1_001).kind).toBe("working");
    expect(heldPresence(start, null, 1_001).kind).toBe(null);
  });
});
