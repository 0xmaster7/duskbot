import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { AFTER_REPLY_MS, justSent, landedReply, LONG_WAIT_MS, MASCOT_MIN_MS, MASCOT_MS, nextReplySlotChange, replySlotPhase, waitKey, type ReplySlotInput } from "./reply-slot";

const ask: Message = { id: "ask", role: "user", kind: "text", at: 1, text: "how was your day?", sendId: "s1" };
const reply: Message = { id: "r1", role: "bot", kind: "text", at: 2, text: "Fair, quiet day", from: { botId: "nova", name: "Nova", color: "green" } };
const tool: Message = { id: "a1", role: "bot", kind: "activity", at: 2, tool: { name: "Bash", itemId: "i1" } };

const at = (input: Partial<ReplySlotInput>): ReplySlotInput => ({
  waiting: true, landed: false, phase: "friendly:generic", streaming: false, ended: false, waitedMs: 0, sinceReplyMs: 0, worked: false, ...input,
});

describe("the reply slot", () => {
  it("shows the mark right after a send, then the typing dots", () => {
    expect(replySlotPhase(at({ waitedMs: 0 }))).toBe("mascot");
    expect(replySlotPhase(at({ waitedMs: MASCOT_MS - 1 }))).toBe("mascot");
    expect(replySlotPhase(at({ waitedMs: MASCOT_MS }))).toBe("dots");
    expect(nextReplySlotChange(at({ waitedMs: 200 }))).toBe(MASCOT_MS - 200);
  });

  it("turns into the dots as soon as the reply starts, once the mark has had its shortest moment", () => {
    expect(replySlotPhase(at({ waitedMs: 100, streaming: true })), "never a flash of the mark").toBe("mascot");
    expect(nextReplySlotChange(at({ waitedMs: 100, streaming: true }))).toBe(MASCOT_MIN_MS - 100);
    expect(replySlotPhase(at({ waitedMs: MASCOT_MIN_MS, streaming: true }))).toBe("dots");
    expect(replySlotPhase(at({ waitedMs: MASCOT_MIN_MS, phase: "friendly:chat.typing" }))).toBe("dots");
    expect(nextReplySlotChange(at({ waitedMs: MASCOT_MIN_MS, streaming: true }))).toBeNull();
  });

  it("is gone in the frame the reply lands, though the engine still calls the turn typing", () => {
    for (const phase of ["friendly:chat.typing", "friendly:generic", "friendly:thinking", undefined]) {
      expect(replySlotPhase(at({ landed: true, phase, waitedMs: 3_000 }))).toBe("hidden");
    }
    expect(replySlotPhase(at({ landed: true, ended: true, sinceReplyMs: 60_000 }))).toBe("hidden");
  });

  it("counts the bot's words after the person's newest message, in a room only the answering bot's own", () => {
    expect(landedReply([ask, reply])).toBe(reply);
    expect(landedReply([ask, reply, tool])).toBe(reply);
    expect(landedReply([reply, ask])).toBeUndefined();
    expect(landedReply([reply, ask, tool])).toBeUndefined();
    expect(landedReply([ask, reply], "nova")).toBe(reply);
    expect(landedReply([ask, reply], "quill")).toBeUndefined();
  });

  it("shows the working line for named work, and keeps it between steps", () => {
    expect(replySlotPhase(at({ phase: "friendly:chat.friendly.commands" }))).toBe("status");
    expect(replySlotPhase(at({ waitedMs: 2_000, worked: true }))).toBe("status");
    // the reply starting after the work goes back to the dots, so the bubble can grow out of them
    expect(replySlotPhase(at({ worked: true, streaming: true, waitedMs: 2_000 }))).toBe("dots");
    expect(nextReplySlotChange(at({ phase: "friendly:chat.friendly.code" }))).toBeNull();
  });

  it("makes a long quiet wait the working line", () => {
    expect(replySlotPhase(at({ waitedMs: LONG_WAIT_MS - 1 }))).toBe("dots");
    expect(replySlotPhase(at({ waitedMs: LONG_WAIT_MS }))).toBe("status");
    expect(nextReplySlotChange(at({ waitedMs: 1_000 }))).toBe(LONG_WAIT_MS - 1_000);
  });

  it("brings the working line back under a reply only when the turn goes on", () => {
    expect(replySlotPhase(at({ landed: true, phase: "friendly:chat.friendly.code" }))).toBe("status");
    expect(replySlotPhase(at({ landed: true, sinceReplyMs: AFTER_REPLY_MS - 1 }))).toBe("hidden");
    expect(nextReplySlotChange(at({ landed: true, sinceReplyMs: 500 }))).toBe(AFTER_REPLY_MS - 500);
    expect(replySlotPhase(at({ landed: true, sinceReplyMs: AFTER_REPLY_MS }))).toBe("status");
    // a second message streaming after the first gets its own dots
    expect(replySlotPhase(at({ landed: true, streaming: true }))).toBe("dots");
  });

  it("is hidden when nothing is awaited", () => {
    expect(replySlotPhase(at({ waiting: false }))).toBe("hidden");
    expect(nextReplySlotChange(at({ waiting: false }))).toBeNull();
  });

  it("keys a wait by the person's newest message, the same before and after the server confirms it", () => {
    const optimistic = { ...ask, id: "optimistic-s1" };
    expect(waitKey([reply, optimistic])).toBe(waitKey([reply, ask]));
    expect(waitKey([ask, reply, { ...ask, id: "ask2", sendId: "s2" }])).toBe("s2");
    expect(waitKey([reply])).toBe("");
    expect(justSent(optimistic)).toBe(true);
    expect(justSent(ask)).toBe(false);
  });
});
