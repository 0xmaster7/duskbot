import type { Action, Message } from "./store";

export function applySendReceipt(
  sent: { body: unknown } | { arrived: true },
  sendId: string,
  text: string,
  dispatch: (action: Action) => void,
): void {
  if (!("body" in sent) || !sent.body || typeof sent.body !== "object") return;
  const body = sent.body as { threadId?: unknown; message?: Message; queued?: boolean; queueId?: unknown; reason?: unknown };
  if (typeof body.threadId !== "string") return;
  if (body.message) dispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
  if (!body.queued || typeof body.queueId !== "string") return;
  dispatch({ type: "optimisticMessageRemoved", threadId: body.threadId, sendId });
  dispatch({ type: "pendingQueued", threadId: body.threadId, queueId: body.queueId, text,
    reason: body.reason === "capacity" || body.reason === "group-turn" ? body.reason : undefined });
}
