import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runtimeFrameAction } from "@/state/store";
import type { RuntimeEvent } from "../../shared/runtime-events";
import { forgetStopPress, forgetStops, isLateRow, noteLateRow, sendStop, STOP_REPEAT_MS, stopPress } from "./stop-turn";
import { liveReply, noteReplyEvent, resetLiveReplies } from "@/state/live-reply";

const frame = (type: string, turnId: string, threadId = "thread-1") =>
  ({ eventId: `e-${Math.random()}`, provider: "fake", threadId, turnId, createdAt: "", type, ok: true }) as unknown as RuntimeEvent;

const bodies = (api: ReturnType<typeof vi.fn>) => api.mock.calls.map(([path, init]) => [path, JSON.parse(String(init?.body ?? "null"))]);

beforeEach(() => {
  vi.useFakeTimers();
  forgetStops();
  resetLiveReplies();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Stop", () => {
  it("names the turn the live frames say is running", () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    runtimeFrameAction(frame("turn.started", "turn-1"));
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-1" }, vi.fn());
    expect(bodies(api)).toEqual([["/api/bots/bot-1/interrupt", { threadId: "thread-1", turnId: "turn-1" }]]);
  });

  it("names no turn once that turn has ended, so a Stop during the next dispatch still reaches it", () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    runtimeFrameAction(frame("turn.started", "turn-1"));
    runtimeFrameAction(frame("turn.completed", "turn-1"));
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-1" }, vi.fn());
    expect(bodies(api)).toEqual([["/api/bots/bot-1/interrupt", { threadId: "thread-1" }]]);
  });

  it("sends a double click's second Stop nowhere", () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    runtimeFrameAction(frame("turn.started", "turn-1"));
    const action = { type: "interrupt", botId: "bot-1", threadId: "thread-1" } as const;
    sendStop(api, action, vi.fn());
    // The stopped turn ends and the queued message starts before the second click lands.
    runtimeFrameAction(frame("turn.completed", "turn-1"));
    runtimeFrameAction(frame("turn.started", "turn-2"));
    vi.advanceTimersByTime(STOP_REPEAT_MS - 1);
    sendStop(api, action, vi.fn());
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("takes a later, deliberate Stop", () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    const action = { type: "interrupt", botId: "bot-1", threadId: "thread-1" } as const;
    runtimeFrameAction(frame("turn.started", "turn-1"));
    sendStop(api, action, vi.fn());
    runtimeFrameAction(frame("turn.completed", "turn-1"));
    runtimeFrameAction(frame("turn.started", "turn-2"));
    vi.advanceTimersByTime(STOP_REPEAT_MS);
    sendStop(api, action, vi.fn());
    expect(bodies(api).map(([, body]) => body)).toEqual([{ threadId: "thread-1", turnId: "turn-1" }, { threadId: "thread-1", turnId: "turn-2" }]);
  });

  it("forgets a turn the server says is already over, so a missed frame never blocks the next Stop", async () => {
    const api = vi.fn().mockResolvedValueOnce({ ok: true, outcome: "already-stopped" }).mockResolvedValue({ ok: true });
    const action = { type: "interrupt", botId: "bot-1", threadId: "thread-1" } as const;
    // This client never saw turn-1 end or turn-2 start (a dropped connection).
    runtimeFrameAction(frame("turn.started", "turn-1"));
    sendStop(api, action, vi.fn());
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    vi.advanceTimersByTime(STOP_REPEAT_MS);
    sendStop(api, action, vi.fn());
    expect(bodies(api).map(([, body]) => body)).toEqual([{ threadId: "thread-1", turnId: "turn-1" }, { threadId: "thread-1" }]);
  });

  it("keeps each thread's Stop to itself", () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-1" }, vi.fn());
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-2" }, vi.fn());
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("lets the next press through after a Stop the server refused, and says why", async () => {
    const api = vi.fn().mockRejectedValueOnce(new Error("the bot switched tasks")).mockResolvedValue({ ok: true });
    const showError = vi.fn();
    const onError = vi.fn();
    const action = { type: "interrupt", botId: "bot-1", threadId: "thread-1", onError } as const;
    sendStop(api, action, showError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(showError).toHaveBeenCalledWith(expect.objectContaining({ message: "the bot switched tasks" }));
    sendStop(api, action, showError);
    expect(api).toHaveBeenCalledTimes(2);
  });
});

describe("the press itself", () => {
  it("shows the turn over at once, before the server answers, and cuts what was streaming", () => {
    const api = vi.fn(() => new Promise(() => {}));
    runtimeFrameAction(frame("turn.started", "turn-1"));
    noteReplyEvent({ ...frame("content.delta", "turn-1"), streamKind: "assistant_text", delta: "Cheese" } as RuntimeEvent);
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-1" }, vi.fn());
    expect(stopPress("thread-1")).toMatchObject({ turnId: "turn-1" });
    expect(liveReply("thread-1")).toMatchObject({ text: "Cheese", cut: true });
  });

  it("lasts until another turn starts or the person sends again", () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    runtimeFrameAction(frame("turn.started", "turn-1"));
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-1" }, vi.fn());
    runtimeFrameAction(frame("turn.completed", "turn-1"));
    expect(stopPress("thread-1")).toBeDefined();
    runtimeFrameAction(frame("turn.started", "turn-2"));
    expect(stopPress("thread-1")).toBeUndefined();
    vi.advanceTimersByTime(STOP_REPEAT_MS);
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-1" }, vi.fn());
    forgetStopPress("thread-1");
    expect(stopPress("thread-1")).toBeUndefined();
  });

  it("gives the turn back when the server refuses the Stop", async () => {
    const api = vi.fn().mockRejectedValue(new Error("offline"));
    runtimeFrameAction(frame("turn.started", "turn-1"));
    sendStop(api, { type: "interrupt", botId: "bot-1", threadId: "thread-1" }, vi.fn());
    expect(stopPress("thread-1")).toBeDefined();
    await vi.runAllTimersAsync();
    expect(stopPress("thread-1")).toBeUndefined();
  });

  it("remembers a late row for good", () => {
    noteLateRow("m-late");
    expect(isLateRow("m-late")).toBe(true);
    forgetStops();
    expect(isLateRow("m-late")).toBe(false);
  });
});
