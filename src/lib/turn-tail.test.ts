import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { awaitedMemberId, landedReply, LINE_BACK_AFTER_REPLY_MS, replyHidesLine, showWorkingDots } from "./turn-tail";

const msg = (m: Partial<Message>): Message => ({ id: "m1", role: "bot", kind: "text", at: 1, ...m });

describe("showWorkingDots", () => {
  it("hides the dots when the bot is idle", () => {
    expect(showWorkingDots(false, msg({ role: "user" }))).toBe(false);
  });

  it("shows the dots while a turn runs with nothing settled yet", () => {
    expect(showWorkingDots(true, undefined)).toBe(true);
    expect(showWorkingDots(true, msg({ role: "user" }))).toBe(true);
    expect(showWorkingDots(true, msg({ kind: "activity" }))).toBe(true);
    expect(showWorkingDots(true, msg({ kind: "options" }))).toBe(true);
  });

  it("stays through the bot's words in the middle of a turn: a sentence is not the turn's end", () => {
    expect(showWorkingDots(true, msg({}))).toBe(true);
    expect(showWorkingDots(true, msg({}), undefined, false)).toBe(true);
  });

  it("keeps the dots hidden after the reply settles and the turn has ended, while busy winds down", () => {
    expect(showWorkingDots(true, msg({}), undefined, true)).toBe(false);
  });

  it("an ended turn hides nothing a newer row says is running", () => {
    expect(showWorkingDots(true, msg({ role: "user" }), undefined, true)).toBe(true);
    expect(showWorkingDots(true, msg({ kind: "activity" }), undefined, true)).toBe(true);
  });

  it("rooms: a settled reply only covers the bot that said it, once its turn has ended", () => {
    const fromA = msg({ from: { botId: "a", name: "A", color: "blue" } });
    expect(showWorkingDots(true, fromA, "a", true)).toBe(false);
    expect(showWorkingDots(true, fromA, "a", false)).toBe(true);
    expect(showWorkingDots(true, fromA, "b", true)).toBe(true);
    expect(showWorkingDots(true, msg({}), "a", true)).toBe(true);
  });
});

describe("awaitedMemberId", () => {
  const waitChip = msg({
    kind: "activity",
    from: { botId: "b", name: "B", color: "blue" },
    tool: { name: "B is finishing another conversation — will reply here when free", spoken: "B is finishing another conversation" },
  });

  it("names the member whose wait chip is the newest thing in a working room with no speaker", () => {
    expect(awaitedMemberId(true, null, waitChip)).toBe("b");
    expect(awaitedMemberId(true, undefined, waitChip)).toBe("b");
  });

  it("stands down once someone has the floor or the room stops working", () => {
    expect(awaitedMemberId(true, "a", waitChip)).toBeUndefined();
    expect(awaitedMemberId(false, null, waitChip)).toBeUndefined();
    expect(awaitedMemberId(undefined, null, waitChip)).toBeUndefined();
  });

  it("ignores a settled chip and any other tail", () => {
    expect(awaitedMemberId(true, null, { ...waitChip, tool: { ...waitChip.tool!, ok: true } })).toBeUndefined();
    expect(awaitedMemberId(true, null, { ...waitChip, tool: { ...waitChip.tool!, ok: false } })).toBeUndefined();
    expect(awaitedMemberId(true, null, msg({ from: { botId: "b", name: "B", color: "blue" } }))).toBeUndefined();
    expect(awaitedMemberId(true, null, msg({ kind: "goal.run" }))).toBeUndefined();
    expect(awaitedMemberId(true, null, undefined)).toBeUndefined();
  });
});

describe("a landed reply and the working line", () => {
  const ask = msg({ id: "ask", role: "user" });
  const reply = msg({ id: "reply", from: { botId: "a", name: "A", color: "blue" } });
  const tool = msg({ id: "tool", kind: "activity" });

  it("finds the bot's words after the person's newest message, in a room only the speaker's own", () => {
    expect(landedReply([ask, reply])).toBe(reply);
    expect(landedReply([ask, reply, tool])).toBe(reply);
    expect(landedReply([reply, ask])).toBeUndefined();
    expect(landedReply([ask, reply], "a")).toBe(reply);
    expect(landedReply([ask, reply], "b")).toBeUndefined();
  });

  it("hides the line in the frame the reply lands, whatever the engine still calls the turn", () => {
    for (const phase of [undefined, "friendly:generic", "friendly:thinking", "friendly:chat.typing"]) {
      expect(replyHidesLine(0, phase)).toBe(true);
    }
    expect(replyHidesLine(null, "friendly:chat.typing"), "no reply yet").toBe(false);
  });

  it("lets the line back for a named step, or once the turn has run on a while", () => {
    expect(replyHidesLine(0, "friendly:code")).toBe(false);
    expect(replyHidesLine(LINE_BACK_AFTER_REPLY_MS - 1, "friendly:generic")).toBe(true);
    expect(replyHidesLine(LINE_BACK_AFTER_REPLY_MS, "friendly:generic")).toBe(false);
  });
});
