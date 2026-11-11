// A send shows at once as an optimistic user message; the server's copy, which carries the same sendId, replaces it.
import { ApiError } from "./api";
import type { Message } from "./store";
import { listenLiveFrames } from "../lib/live-events";

export const optimisticMessageId = (sendId: string): string => `optimistic-${sendId}`;

export function optimisticUserMessage(
  text: string,
  sendId: string,
  replyToId?: string,
  parentId?: string | null,
  channelMode?: "chat" | "goal",
): Message {
  return {
    id: optimisticMessageId(sendId),
    role: "user",
    kind: "text",
    text,
    at: Date.now(),
    parentId: parentId ?? null,
    replyToId,
    sendId,
    channelMode,
  };
}

/** Whether the server's copy of a send is in these messages. */
export function sendArrived(messages: readonly Message[] | undefined, sendId: string): boolean {
  return Boolean(messages?.some((message) => message.sendId === sendId && message.id !== optimisticMessageId(sendId)));
}

/** Long enough to ride out a linked server's tunnel stalling for most of a minute (seen live: 39 s over the relay). */
export const LOST_SEND_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 20_000] as const;

/** A proxy in front of the server answered (the link to a VPS is down or timed out, a Cloud edge is waking it): the
 * send may have reached the server or may reach it soon, and the server never delivers one sendId twice. */
export function sendAnswerLost(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 502 || error.status === 503 || error.status === 504;
  return (error as { name?: unknown } | null)?.name !== "AbortError";
}

export interface SendDelivery {
  threadId: string;
  sendId: string;
  text: string;
  replyToId?: string;
  channelMode?: "chat" | "goal";
}

function confirmsSend(body: unknown, threadId: string): boolean {
  if (!body || typeof body !== "object") return false;
  const receipt = body as { ok?: unknown; threadId?: unknown; message?: { id?: unknown }; queued?: unknown; queueId?: unknown; handled?: unknown };
  return receipt.ok === true && receipt.threadId === threadId &&
    (typeof receipt.message?.id === "string" || (receipt.queued === true && typeof receipt.queueId === "string") || receipt.handled === true);
}

/** A send whose answer was lost may still have reached the server. It is asked again with the same sendId, which the
 * server never delivers twice, until it answers, refuses, or its copy arrives on the live stream. A slow answer is
 * never given up on: the server may be waiting on an engine before it steers or queues the message. */
export async function sendReconciled<T>(
  post: (signal: AbortSignal) => Promise<T>,
  arrived: () => boolean,
  wait?: (ms: number) => Promise<void>,
  delivery?: SendDelivery,
): Promise<{ body: T } | { arrived: true }> {
  const owned = new AbortController();
  let confirmed = false;
  let confirm!: (value: { arrived: true }) => void;
  const delivered = new Promise<{ arrived: true }>((resolve) => { confirm = resolve; });
  const stop = delivery ? listenLiveFrames({ onFrame: (frame) => {
    if (frame.kind !== "message" || frame.threadId !== delivery.threadId) return;
    const message = frame.message;
    if (message.sendId !== delivery.sendId || message.id === optimisticMessageId(delivery.sendId) ||
      message.role !== "user" || message.kind !== "text" || message.text !== delivery.text.trim() ||
      message.replyToId !== delivery.replyToId || (message.channelMode ?? "chat") !== (delivery.channelMode ?? "chat")) return;
    confirmed = true;
    confirm({ arrived: true });
    owned.abort();
  } }) : () => {};
  const beforeRetry = (ms: number): Promise<unknown> => wait ? Promise.race([wait(ms), delivered]) : new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); owned.signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    if (owned.signal.aborted) finish();
    else owned.signal.addEventListener("abort", finish, { once: true });
  });
  const attempts = async (): Promise<{ body: T } | { arrived: true }> => {
    for (let attempt = 0; ; attempt++) {
      if (confirmed) return { arrived: true };
      try {
        const body = await post(owned.signal);
        if (delivery && !confirmsSend(body, delivery.threadId)) throw new Error("The server did not confirm this message.");
        return { body };
      } catch (error) {
        if (!sendAnswerLost(error)) throw error;
        if (arrived()) return { arrived: true };
        const delay = LOST_SEND_RETRY_MS[attempt];
        if (delay === undefined) throw error;
        await beforeRetry(delay);
        if (arrived()) return { arrived: true };
      }
    }
  };
  try {
    return await Promise.race([attempts(), delivered]);
  } finally {
    stop();
    owned.abort();
  }
}
