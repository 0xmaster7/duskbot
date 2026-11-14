// One Stop per press. The desktop learns each thread's running turn from its live runtime frames and names it in
// the Stop, so a Stop the server receives after that turn ended reaches nothing (it answers "already-stopped")
// instead of the queued message that started next. A repeat within a second, the second click of a double click,
// never leaves this client at all.
import { useSyncExternalStore } from "react";

import type { RuntimeEvent } from "../../shared/runtime-events";
import { cutLiveReply, liveReply } from "@/state/live-reply";

export const STOP_REPEAT_MS = 1_000;

const liveTurns = new Map<string, string>();
const turnStarts = new Map<string, number>();
const lastStops = new Map<string, number>();
const stopsHere = new Map<string, number>();
/** A Stop pressed here whose turn has not been followed by another: the chat shows the turn over from the press on. */
const pressed = new Map<string, StopPress>();
/** Rows of a stopped turn that landed after its Stop was pressed here: the person stopped before they came. */
const lateRows = new Set<string>();
const settledRows = new Set<string>();
const MAX_LATE_ROWS = 500;
const watchers = new Set<() => void>();
const notify = () => { for (const watch of Array.from(watchers)) watch(); };
const subscribe = (watch: () => void) => {
  watchers.add(watch);
  return () => { watchers.delete(watch); };
};

export interface StopPress {
  at: number;
  /** The turn running when Stop was pressed, when this client knew it. */
  turnId?: string;
  /** The reply words streamed by the press: they settle as the turn's last bubble, and the server keeps exactly these. */
  said?: string;
}

/** Follows turn.started and turn.completed frames; a thread between turns has no live turn to name. */
export function noteRuntimeTurn(event: Pick<RuntimeEvent, "type" | "threadId" | "turnId">): void {
  if (!event.turnId) return;
  if (event.type === "turn.started") {
    liveTurns.set(event.threadId, event.turnId);
    turnStarts.set(event.threadId, (turnStarts.get(event.threadId) ?? 0) + 1);
    // the next turn (a queued message) is not the one the person stopped
    if (pressed.has(event.threadId) && pressed.get(event.threadId)!.turnId !== event.turnId) pressed.delete(event.threadId);
  }
  else if (event.type === "turn.completed" && liveTurns.get(event.threadId) === event.turnId) liveTurns.delete(event.threadId);
  else return;
  notify();
}

/** The live stream restarted without the frames it missed (or the server restarted): what it knew of turns is stale. */
export function forgetLiveTurns(): void {
  liveTurns.clear();
  notify();
}

/** How many turns this client has seen start in a thread: a change means another turn ran. */
export function turnStartCount(threadId: string): number {
  return turnStarts.get(threadId) ?? 0;
}

/** Tests only: start from no live turns and no recent Stops. */
export function forgetStops(): void {
  forgetLiveTurns();
  lastStops.clear();
  stopsHere.clear();
  turnStarts.clear();
  pressed.clear();
  lateRows.clear();
  settledRows.clear();
}

/** The person sent again: whatever the stopped turn looked like, the chat follows the new one. */
export function forgetStopPress(threadId: string): void {
  if (pressed.delete(threadId)) notify();
}

/** The Stop the person pressed in this thread, from the press until another turn starts or they send again. */
export function stopPress(threadId: string | null | undefined): StopPress | undefined {
  return threadId ? pressed.get(threadId) : undefined;
}

export function useStopPress(threadId: string | null | undefined): StopPress | undefined {
  return useSyncExternalStore(subscribe, () => stopPress(threadId), () => undefined);
}

/** A row of the stopped turn that landed after the press: kept out of the chat for good, not only while it settles. */
export function noteLateRow(messageId: string): void {
  if (lateRows.has(messageId)) return;
  lateRows.add(messageId);
  if (lateRows.size > MAX_LATE_ROWS) lateRows.delete(lateRows.values().next().value!);
}

export function forgetLateRow(messageId: string): void {
  lateRows.delete(messageId);
}

export function isLateRow(messageId: string): boolean {
  return lateRows.has(messageId);
}

/** The server's bubble for the words streamed by the press: it takes the place of the one the Stop drew, without an entrance. */
export function noteSettledRow(messageId: string): void {
  settledRows.add(messageId);
  if (settledRows.size > MAX_LATE_ROWS) settledRows.delete(settledRows.values().next().value!);
}

export function isSettledRow(messageId: string): boolean {
  return settledRows.has(messageId);
}

type StopAction = { type: "interrupt"; botId: string; threadId?: string; onError?: () => void };
type Api = (path: string, init?: RequestInit) => Promise<unknown>;

export function sendStop(api: Api, action: StopAction, showError: (error: unknown) => void): void {
  const key = action.threadId ?? `bot:${action.botId}`;
  const now = Date.now();
  const last = lastStops.get(key);
  if (last !== undefined && now - last < STOP_REPEAT_MS) return;
  lastStops.set(key, now);
  const turnId = action.threadId ? liveTurns.get(action.threadId) : undefined;
  const streaming = action.threadId ? liveReply(action.threadId) : null;
  const said = streaming && !streaming.cut && streaming.text.trim() ? streaming.text : undefined;
  // the chat shows the turn over at the press, not when the server answers: the reply stops growing and the button goes
  if (action.threadId) {
    pressed.set(action.threadId, { at: now, ...(turnId ? { turnId } : {}), ...(said ? { said } : {}) });
    cutLiveReply(action.threadId);
    notify();
  }
  api(`/api/bots/${action.botId}/interrupt`, {
    method: "POST",
    body: action.threadId ? JSON.stringify({ threadId: action.threadId, ...(turnId ? { turnId } : {}), ...(said ? { said } : {}) }) : undefined,
  }).then((result) => {
    // That turn was over: this client missed its end. Name none next time, so the next press reaches what runs.
    const over = (result as { outcome?: unknown } | null)?.outcome === "already-stopped";
    if (!over && action.threadId) {
      stopsHere.set(action.threadId, now);
      notify();
    }
    if (over && action.threadId && liveTurns.get(action.threadId) === turnId) {
      liveTurns.delete(action.threadId);
      notify();
    }
  }).catch((error) => {
    // Refused: the next press is a new Stop, not a repeat, and the turn shows running again.
    if (lastStops.get(key) === now) lastStops.delete(key);
    if (action.threadId && pressed.get(action.threadId)?.at === now) {
      pressed.delete(action.threadId);
      notify();
    }
    showError(error);
    action.onError?.();
  });
}

/** When this client's Stop last reached a turn in the thread. */
export function useStoppedAt(threadId: string): number | undefined {
  return useSyncExternalStore(subscribe, () => stopsHere.get(threadId), () => undefined);
}
