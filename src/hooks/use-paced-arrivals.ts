import { useEffect, useRef, useState } from "react";

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
