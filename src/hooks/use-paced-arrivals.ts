import { animate } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { usePrefersReducedMotion } from "@/components/mascot-clock";

/** How long the first reply waits after the status line, and the gap between replies that land together, in ms. */
export const PACE_FIRST_MS = [150, 300] as const;
export const PACE_GAP_MS = [250, 700] as const;
/** A reply that lands this soon after the last one shown waits a gap, not the first wait. */
const BURST_MS = 1200;
/** Past this many fresh replies waiting at once, the oldest show at once so the line never runs minutes behind. */
const MAX_PACED = 8;

interface Arrival {
  id: string;
  role: string;
  at: number;
}

/** Only a row this fresh is a live arrival; an older one (history, a reload, a reconnect) draws at once. */
const LIVE_MS = 15_000;

function seeded(id: string, [min, max]: readonly [number, number]): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return min + ((hash >>> 0) % (max - min));
}

interface PaceState {
  key: string;
  known: Set<string>;
  heldSince: Map<string, number>;
  lastReveal: number;
}

/** The rows a transcript draws now. Rows already there when it opens (and older history loaded later) draw at once;
 * replies that arrive live come in one at a time, the first a short beat after it lands and each next one a seeded
 * 250 to 700 ms after the one before, so several at once read as a conversation. The person's own message never
 * waits: it brings every row before it along, so nothing is ever drawn out of order. `held` is what still waits. */
export function usePacedArrivals<T extends Arrival>(key: string, rows: T[], paced: (row: T) => boolean, now: () => number = Date.now): { shown: T[]; held: T[] } {
  const [, wake] = useState(0);
  const state = useRef<PaceState | null>(null);
  if (!state.current || state.current.key !== key) state.current = { key, known: new Set(rows.map((row) => row.id)), heldSince: new Map(), lastReveal: 0 };
  const pace = state.current;
  const at = now();

  let lastKnown = -1;
  rows.forEach((row, index) => {
    if (pace.known.has(row.id)) lastKnown = index;
  });
  const show = (index: number) => {
    pace.known.add(rows[index]!.id);
    pace.heldSince.delete(rows[index]!.id);
  };
  for (let i = 0; i < lastKnown; i++) show(i);
  const lastOwn = rows.findLastIndex((row, index) => index > lastKnown && row.role === "user");
  for (let i = lastKnown + 1; i <= lastOwn; i++) show(i);
  const waiting = rows.slice(Math.max(lastKnown, lastOwn) + 1).filter((row) => paced(row) && at - row.at <= LIVE_MS).length;
  let skip = Math.max(0, waiting - MAX_PACED);

  let head = Math.max(lastKnown, lastOwn) + 1;
  let due = Infinity;
  while (head < rows.length) {
    const row = rows[head]!;
    if (!paced(row) || skip > 0 || at - row.at > LIVE_MS) {
      if (paced(row)) skip--;
      show(head++);
      continue;
    }
    const since = pace.heldSince.get(row.id) ?? at;
    pace.heldSince.set(row.id, since);
    const readyAt = at - pace.lastReveal < BURST_MS ? Math.max(since, pace.lastReveal + seeded(row.id, PACE_GAP_MS)) : since + seeded(row.id, PACE_FIRST_MS);
    if (at < readyAt) {
      due = readyAt;
      break;
    }
    pace.lastReveal = at;
    show(head++);
  }

  useEffect(() => {
    if (!Number.isFinite(due)) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [due]);

  return head >= rows.length ? { shown: rows, held: [] } : { shown: rows.slice(0, head), held: rows.slice(head) };
}

/** iMessage's lift: a soft spring with a whisper of overshoot. */
const LIFT = { type: "spring", stiffness: 420, damping: 34, mass: 1 } as const;
const FADE = { duration: 0.12, ease: "easeOut" } as const;

/** A row that unmounts mid-entrance cancels its animation; that is not an error. */
const settle = (run: { then: (resolve: () => void, reject?: () => void) => unknown }) => void run.then(() => {}, () => {});

/** While the transcript follows its end, a row added there makes everything glide up into place from where it was,
 * the new row rising from the composer, instead of the scroll snapping it into view. One transform on the column. */
export function useArrivalGlide(columnRef: RefObject<HTMLElement | null>, lastId: string | undefined, following: boolean): void {
  const reduced = usePrefersReducedMotion();
  const height = useRef<{ id: string | undefined; px: number } | null>(null);
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const px = column.offsetHeight;
    const before = height.current;
    height.current = { id: lastId, px };
    if (!before || before.id === lastId || !following || reduced) return;
    const grew = px - before.px;
    if (grew <= 0 || grew > window.innerHeight) return;
    settle(animate(column, { y: [grew, 0] }, LIFT));
  }, [columnRef, lastId, following, reduced]);
}

/** A row that arrives while the conversation is open grows into place: the person's bubble from the composer side, a
 * bot's bubble out of its status line at the start edge. Under reduced motion it only fades in. */
export function useArrivalMotion(rowRef: RefObject<HTMLElement | null>, fresh: boolean, side: "start" | "end"): void {
  const reduced = usePrefersReducedMotion();
  const played = useRef(false);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !fresh || played.current) return;
    played.current = true;
    row.style.transformOrigin = side === "end" ? "100% 100%" : "0% 100%";
    if (reduced) settle(animate(row, { opacity: [0, 1] }, FADE));
    else if (side === "end") settle(animate(row, { scale: [0.96, 1] }, LIFT));
    else settle(animate(row, { opacity: [0, 1], scale: [0.9, 1] }, { opacity: { duration: 0.16, ease: "easeOut" }, scale: LIFT }));
  }, [rowRef, fresh, side, reduced]);
}
