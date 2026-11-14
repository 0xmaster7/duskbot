// A message this window just sent, before the server says its turn is running. The send's answer can take seconds (a
// bot with no AI chosen reads every engine first), and the bot's working row would wait on it; held here, outside the
// app reducer, so a snapshot or reconcile never drops it, and so the row shows the frame the send does.
import { useSyncExternalStore } from "react";

export interface SentTurn {
  sendId: string;
  /** When Enter was pressed: the turn's start as this window shows it. */
  at: number;
  /** sending: the server has not said the turn runs; running: it has, and the row follows the server from now on. */
  phase: "sending" | "running";
}

const sent = new Map<string, SentTurn>();
const listeners = new Map<string, Set<() => void>>();
const giveUps = new Map<string, ReturnType<typeof setTimeout>>();
/** A send the server took, whose turn this window never saw running (it ended before a frame came), stops showing. */
export const SENT_TURN_GIVE_UP_MS = 4_000;

function changed(threadId: string): void {
  for (const listener of Array.from(listeners.get(threadId) ?? [])) listener();
}

function dropTimer(threadId: string): void {
  const timer = giveUps.get(threadId);
  if (timer) clearTimeout(timer);
  giveUps.delete(threadId);
}

/** Enter on a thread whose bot is not already at work. */
export function noteSentTurn(threadId: string, sendId: string, at = Date.now()): void {
  dropTimer(threadId);
  sent.set(threadId, { sendId, at, phase: "sending" });
  changed(threadId);
}

/** The send failed, or the server queued, steered or answered it without a turn of its own. */
export function dropSentTurn(threadId: string, sendId?: string): void {
  const current = sent.get(threadId);
  if (!current || (sendId !== undefined && current.sendId !== sendId)) return;
  dropTimer(threadId);
  sent.delete(threadId);
  changed(threadId);
}

/** The server took the send and started its turn: if no running turn shows up soon, it already ended. */
export function sentTurnAccepted(threadId: string, sendId: string): void {
  const current = sent.get(threadId);
  if (!current || current.sendId !== sendId || current.phase !== "sending") return;
  dropTimer(threadId);
  const timer = setTimeout(() => {
    giveUps.delete(threadId);
    if (sent.get(threadId)?.sendId === sendId && sent.get(threadId)?.phase === "sending") dropSentTurn(threadId, sendId);
  }, SENT_TURN_GIVE_UP_MS);
  (timer as { unref?: () => void }).unref?.();
  giveUps.set(threadId, timer);
}

/** What the bot's row shows: the server's busy once it says so, and the send's start for that turn until it ends. */
export function followSentTurn(threadId: string, busy: boolean): void {
  const current = sent.get(threadId);
  if (!current) return;
  if (busy && current.phase === "sending") {
    dropTimer(threadId);
    sent.set(threadId, { ...current, phase: "running" });
    changed(threadId);
  } else if (!busy && current.phase === "running") {
    dropSentTurn(threadId);
  }
}

export function sentTurn(threadId: string | null | undefined): SentTurn | null {
  return (threadId && sent.get(threadId)) || null;
}

function subscribe(threadId: string | null | undefined, listener: () => void): () => void {
  if (!threadId) return () => {};
  let set = listeners.get(threadId);
  if (!set) listeners.set(threadId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(threadId);
  };
}

export function useSentTurn(threadId: string | null | undefined): SentTurn | null {
  return useSyncExternalStore(
    (listener) => subscribe(threadId, listener),
    () => sentTurn(threadId),
    () => sentTurn(threadId),
  );
}

/** Tests only. */
export function resetSentTurns(): void {
  for (const threadId of Array.from(giveUps.keys())) dropTimer(threadId);
  sent.clear();
}

/** The server's answer to the send: a turn of its own keeps the row; queued, steered or answered without one drops it. */
export function followSendReceipt(sent: { body: unknown } | { arrived: true }, threadId: string, sendId: string): void {
  const body = "body" in sent && sent.body && typeof sent.body === "object"
    ? sent.body as { message?: { steered?: unknown }; queued?: unknown; handled?: unknown; steered?: unknown } : null;
  if (body && (body.queued === true || body.handled === true || body.steered === true || body.message?.steered === true)) {
    dropSentTurn(threadId, sendId);
    return;
  }
  sentTurnAccepted(threadId, sendId);
}
