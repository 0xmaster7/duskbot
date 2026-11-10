// What the person has already seen. A finished reply or a failure is news until they see it: read in any window or on
// the phone (the chat is no longer unread), opened from a surface, looked at in an open panel, or dismissed. Then it
// leaves the island's and the dock's attention and only shows, muted, as recent. Asks never go this way: they stay
// until answered.
import { useEffect, useRef, useState } from "react";
import { isBusy } from "./mood";
import type { AmbientBot, AmbientBridge } from "./types";

/** An open panel counts as a look at what it showed after this long, so a pointer passing over it is not one. */
export const LOOK_MS = 700;
/** The panel's Recent list. */
export const RECENT_MAX = 4;

/** One finished turn or failure: the same until the bot's chat moves on. */
export const eventKey = (bot: Pick<AmbientBot, "id" | "status" | "at">): string => `${bot.id}:${bot.status}:${bot.at}`;
const isEvent = (bot: AmbientBot) => bot.status === "done" || bot.status === "error";

/** A reply or failure the person has not seen yet. */
export function isFresh(bot: AmbientBot, seen: ReadonlySet<string>): boolean {
  return isEvent(bot) && bot.unread && !seen.has(eventKey(bot));
}

/** A reply or failure already seen: it shows only as recent. */
export const isSeenEvent = (bot: AmbientBot, seen: ReadonlySet<string>): boolean => isEvent(bot) && !isFresh(bot, seen);

/** The bots as the surfaces' attention sees them: a seen reply or failure rests, like an idle bot, and so does whatever
 * the person is watching in the app (summary.ts `quiet`). */
export function attention(bots: readonly AmbientBot[], seen: ReadonlySet<string>): AmbientBot[] {
  return bots.map((bot) => (isSeenEvent(bot, seen) || bot.quiet ? { ...bot, status: "idle", unread: false, detail: "", waits: null, asks: 0 } : bot));
}

/** Seen replies and failures, newest first, for the Recent list. */
export function recentOf(bots: readonly AmbientBot[], seen: ReadonlySet<string>, max = RECENT_MAX): AmbientBot[] {
  return bots.filter((bot) => isSeenEvent(bot, seen) && bot.line).sort((a, b) => b.at - a.at).slice(0, max);
}

/**
 * The seen keys main keeps, and how a surface adds to them. While `looking` (its panel open), every fresh reply or
 * failure it shows is noted; once the panel closes after a real look they count as seen, so nothing changes under the
 * person's eyes.
 */
export function useSeen(bridge: AmbientBridge, bots: readonly AmbientBot[], looking: boolean) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => bridge.onSeen?.((keys) => setSeen(new Set(keys))), [bridge]);
  const mark = (keys: string[]) => {
    const fresh = keys.filter((key) => !seen.has(key));
    if (!fresh.length) return;
    setSeen((was) => new Set([...was, ...fresh]));
    bridge.seen?.(fresh);
  };
  const look = useRef<{ since: number; keys: Set<string> } | null>(null);
  const markNow = useRef(mark);
  markNow.current = mark;
  useEffect(() => {
    if (looking) { look.current = { since: Date.now(), keys: new Set() }; return; }
    const was = look.current;
    look.current = null;
    if (was && Date.now() - was.since >= LOOK_MS) markNow.current([...was.keys]);
  }, [looking]);
  useEffect(() => {
    if (!look.current) return;
    for (const bot of bots) if (isFresh(bot, seen)) look.current.keys.add(eventKey(bot));
  }, [bots, seen, looking]);
  return { seen, mark };
}

export type News = "ask" | "reply" | "error" | null;

/** What a mascot's bubble says: an ask, an unseen reply, an unseen failure, or nothing at all. */
export function newsOf(bot: AmbientBot, seen: ReadonlySet<string>): News {
  if (bot.quiet) return null;
  if (bot.status === "needs-you") return "ask";
  if (!isFresh(bot, seen)) return null;
  return bot.status === "error" ? "error" : "reply";
}

/** The small mark on a mascot for how it is doing, as the island says it: blue while it works, green for a reply not
 * yet seen. */
export function dotOf(bot: AmbientBot, news: News): "working" | "done" | null {
  if (isBusy(bot.status)) return "working";
  return news === "reply" ? "done" : null;
}
