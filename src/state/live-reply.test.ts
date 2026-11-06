import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../../shared/runtime-events";
import { forgetLiveReplies, LIVE_REPLY_ORPHAN_MS, liveReply, noteReplyEvent, noteReplyLanded, replacedLiveReply, resetLiveReplies, shownReplyText } from "./live-reply";

const frame = (event: Partial<RuntimeEvent>) => ({ eventId: "e", threadId: "t", ...event }) as RuntimeEvent;
const delta = (text: string, streamKind: "assistant_text" | "reasoning_text" = "assistant_text") => noteReplyEvent(frame({ type: "content.delta", streamKind, delta: text }), 10);

afterEach(() => {
  resetLiveReplies();
  vi.useRealTimers();
});

describe("a streaming reply", () => {
  it("gathers the reply's deltas, never the reasoning's", () => {
    delta("Sure. ");
    delta("thinking about it", "reasoning_text");
    delta("Here it is");
    expect(liveReply("t")).toEqual({ text: "Sure. Here it is", startedAt: 10 });
  });

  it("stops reading as streaming when the stream restarts without the frames it missed", () => {
    delta("Sure.");
    forgetLiveReplies();
    expect(liveReply("t")).toBeNull();
  });

  it("gives way to its message, which then arrives without an entrance", () => {
    delta("Sure.");
    noteReplyLanded("t", "m1");
    expect(liveReply("t")).toBeNull();
    expect(replacedLiveReply("m1")).toBe(true);
    noteReplyLanded("t", "m2");
    expect(replacedLiveReply("m2"), "a message nothing streamed for keeps its entrance").toBe(false);
  });

  it("lets go of words whose turn ended without a message, after a beat, and starts over with a new turn", () => {
    vi.useFakeTimers();
    delta("Half a");
    noteReplyEvent(frame({ type: "turn.completed", ok: false }));
    expect(liveReply("t")?.text).toBe("Half a");
    vi.advanceTimersByTime(LIVE_REPLY_ORPHAN_MS);
    expect(liveReply("t")).toBeNull();
    delta("Old");
    noteReplyEvent(frame({ type: "turn.started" }));
    expect(liveReply("t")).toBeNull();
  });

  it("masks secrets and holds back a private key that has not ended", () => {
    expect(shownReplyText("key -----BEGIN RSA PRIVATE KEY-----\nabc")).toBe("key ");
  });
});
