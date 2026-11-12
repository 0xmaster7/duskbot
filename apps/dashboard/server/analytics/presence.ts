// who is on the site right now, in memory only and never stored: pings from open pages and the owner's own visits.
import { ONLINE_MS } from "./web.ts";

export interface Present {
  /** the visitor id the event log uses (so a visitor is counted once), or `owner:<vid>` for the owner's own browser */
  key: string; at: number; page: string; owner: boolean;
  country?: string; city?: string; lat?: number; lon?: number;
}

const MAX_PRESENT = 20_000;

export function createPresence(now: () => number = Date.now) {
  const seen = new Map<string, Present>();
  function prune(at: number) {
    for (const [key, entry] of seen) {
      if (entry.at >= at - ONLINE_MS) break;
      seen.delete(key);
    }
  }
  return {
    touch(entry: Omit<Present, "at">) {
      const at = now();
      seen.delete(entry.key);
      seen.set(entry.key, { ...entry, at });
      prune(at);
      if (seen.size > MAX_PRESENT) seen.delete(seen.keys().next().value!);
    },
    /** everyone seen in the last five minutes, newest last */
    list(at = now()): Present[] {
      prune(at);
      return [...seen.values()].filter(entry => entry.at <= at + 60_000);
    },
  };
}
export type PresenceStore = ReturnType<typeof createPresence>;
