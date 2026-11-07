import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerFrame } from "../../shared/wire";
import { publishLiveFrame, publishMissedFrames } from "../lib/live-events";
import { ApiError } from "./api";
import { optimisticMessageId, sendReconciled, type SendDelivery } from "./optimistic-send";

const delivery: SendDelivery = { threadId: "thread-one", sendId: "send-0123456789abcdef", text: "Hello", replyToId: "reply-one" };
const message = (patch = {}): ServerFrame => ({ kind: "message", threadId: delivery.threadId,
  message: { id: "canonical", role: "user", kind: "text", text: delivery.text, at: 1, sendId: delivery.sendId, replyToId: delivery.replyToId, ...patch } });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("canonical send confirmation", () => {
  it("settles a stalled HTTP response from the pinned thread's canonical event and aborts only its request", async () => {
    let owned!: AbortSignal;
    const unrelated = new AbortController();
    const post = vi.fn((signal: AbortSignal) => {
      owned = signal;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const result = sendReconciled(post, () => false, undefined, delivery);
    publishMissedFrames();
    publishLiveFrame(message());
    await expect(result).resolves.toEqual({ arrived: true });
    expect(post).toHaveBeenCalledOnce();
    expect(owned.aborted).toBe(true);
    expect(unrelated.signal.aborted).toBe(false);
  });

  it("does not accept another chat, conflicting text, an optimistic row, or a different channel mode", async () => {
    let finish!: (body: object) => void;
    let settled = false;
    const result = sendReconciled(() => new Promise<object>((resolve) => { finish = resolve; }), () => false, undefined, delivery);
    void result.then(() => { settled = true; });
    publishLiveFrame({ ...message(), threadId: "other-thread" } as ServerFrame);
    for (const patch of [{ text: "Different" }, { sendId: "another-send-id" }, { replyToId: "another-reply" },
      { id: optimisticMessageId(delivery.sendId) }, { role: "bot" }, { channelMode: "goal" }]) publishLiveFrame(message(patch));
    await flush();
    expect(settled).toBe(false);
    const receipt = { ok: true, threadId: delivery.threadId, message: { id: "accepted" } };
    finish(receipt);
    await expect(result).resolves.toEqual({ body: receipt });
  });

  it("keeps HTTP success and a queue receipt when the live event is missing", async () => {
    for (const body of [{ ok: true, threadId: delivery.threadId, message: { id: "accepted" } }, { ok: true, queued: true, queueId: "queue", threadId: delivery.threadId }]) {
      await expect(sendReconciled(async () => body, () => false, undefined, delivery)).resolves.toEqual({ body });
    }
  });

  it("retries an unconfirmed success instead of silently losing an optimistic message", async () => {
    const body = { ok: true, threadId: delivery.threadId, message: { id: "accepted" } };
    const post = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(body);
    await expect(sendReconciled(post, () => false, async () => {}, delivery)).resolves.toEqual({ body });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("preserves a server refusal and never retries it", async () => {
    const post = vi.fn(async () => { throw new ApiError("Not permitted", 403); });
    await expect(sendReconciled(post, () => false, undefined, delivery)).rejects.toMatchObject({ status: 403 });
    publishLiveFrame(message());
    expect(post).toHaveBeenCalledOnce();
  });

  it("confirms during a retry wait without sending again or leaving a timer behind", async () => {
    vi.useFakeTimers();
    const post = vi.fn(async () => { throw new TypeError("Connection lost"); });
    const result = sendReconciled(post, () => false, undefined, delivery);
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    publishLiveFrame(message());
    await expect(result).resolves.toEqual({ arrived: true });
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds repeated stalled requests and preserves the retry count", async () => {
    const timeouts: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController(); timeouts.push(controller); return controller.signal;
    });
    const post = vi.fn((signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const waits: number[] = [];
    const result = expect(sendReconciled(post, () => false, async (ms) => { waits.push(ms); }, delivery)).rejects.toMatchObject({ name: "TimeoutError" });
    for (let i = 0; i < 3; i++) {
      timeouts[i]!.abort(new DOMException("Timed out", "TimeoutError"));
      await flush();
    }
    await result;
    expect(waits).toEqual([1_000, 3_000]);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("keeps many rapid sends independent when events arrive out of order across chats", async () => {
    const posts: Array<ReturnType<typeof vi.fn>> = [];
    const sends = Array.from({ length: 20 }, (_, index) => {
      const own = { ...delivery, threadId: `thread-${index % 2}`, sendId: `send-${index.toString().padStart(16, "0")}`, text: `Line ${index}` };
      const post = vi.fn((signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
      posts.push(post);
      return { own, result: sendReconciled(post, () => false, undefined, own) };
    });
    for (const { own } of [...sends].reverse()) publishLiveFrame({ kind: "message", threadId: own.threadId,
      message: { id: `accepted-${own.sendId}`, role: "user", kind: "text", text: own.text, at: 1, sendId: own.sendId, replyToId: own.replyToId } });
    expect(await Promise.all(sends.map((send) => send.result))).toEqual(Array.from({ length: 20 }, () => ({ arrived: true })));
    expect(posts.every((post) => post.mock.calls.length === 1)).toBe(true);
  });
});
