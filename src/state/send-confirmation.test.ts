import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerFrame } from "../../shared/wire";
import { publishLiveFrame, publishMissedFrames } from "../lib/live-events";
import { ApiError } from "./api";
import { LOST_SEND_RETRY_MS, optimisticMessageId, sendReconciled, type SendDelivery } from "./optimistic-send";

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

  it("keeps asking through a tunnel that stalls for most of a minute, with the same send", async () => {
    // a message typed while the relay stalled went back into the composer after 4 s and never reached the bot
    const body = { ok: true, threadId: delivery.threadId, message: { id: "accepted" } };
    const waited: number[] = [];
    let failures = 5;
    const post = vi.fn(async () => { if (failures-- > 0) throw new TypeError("Failed to fetch"); return body; });
    await expect(sendReconciled(post, () => false, async (ms) => { waited.push(ms); }, delivery)).resolves.toEqual({ body });
    expect(post).toHaveBeenCalledTimes(6);
    expect(waited.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(30_000);
    expect(LOST_SEND_RETRY_MS.reduce((sum: number, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(45_000);
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

  it("waits out a slow steered or queued receipt without a live event instead of failing or resending", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    for (const body of [{ ok: true, steered: true, threadId: delivery.threadId, message: { id: "steered" } },
      { ok: true, queued: true, queueId: "queue", threadId: delivery.threadId }]) {
      let signal!: AbortSignal;
      const post = vi.fn((owned: AbortSignal) => { signal = owned; return new Promise((resolve) => setTimeout(() => resolve(body), 120_000)); });
      const result = sendReconciled(post, () => false, undefined, delivery);
      await vi.advanceTimersByTimeAsync(119_000);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(result).resolves.toEqual({ body });
      expect(post).toHaveBeenCalledOnce();
    }
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
