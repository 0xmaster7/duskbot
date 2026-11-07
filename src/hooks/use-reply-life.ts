import { useEffect, useRef, useState } from "react";

import { lifeAt, type LifeBeat } from "@/lib/reply-life";

/** One bot's quiet wait, timed from when this client first saw it under its seed (a server's clock may be off from
 * ours); `typing` while its reply is being written. */
export interface LifeTurn {
  key: string;
  seed: string;
  typing: boolean;
}

const NONE: ReadonlyMap<string, LifeBeat> = new Map();

/** The beat each waiting bot's mark is on now, waking for the next one. A bot that stops waiting is forgotten. */
export function useReplyLife(turns: readonly LifeTurn[]): ReadonlyMap<string, LifeBeat> {
  const [, wake] = useState(0);
  const seen = useRef(new Map<string, { seed: string; at: number }>());
  const now = Date.now();
  const beats = turns.length > 0 ? new Map<string, LifeBeat>() : NONE;
  let due = Infinity;
  for (const turn of turns) {
    let first = seen.current.get(turn.key);
    if (!first || first.seed !== turn.seed) {
      first = { seed: turn.seed, at: now };
      seen.current.set(turn.key, first);
    }
    const start = first.at;
    const { beat, nextAtMs } = lifeAt(turn.seed, now - start, turn.typing);
    (beats as Map<string, LifeBeat>).set(turn.key, beat);
    due = Math.min(due, start + nextAtMs);
  }
  for (const key of seen.current.keys()) if (!turns.some((turn) => turn.key === key)) seen.current.delete(key);
  useEffect(() => {
    if (!Number.isFinite(due)) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [due]);
  return beats;
}
