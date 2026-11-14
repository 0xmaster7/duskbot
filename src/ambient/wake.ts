// When the notch island wakes on its own, and how it says why. Only for what needs the person or is worth their
// attention: an ask, a failure, a long task done or a routine's result. A bot at work or a quick reply stays quiet.
import { isFresh } from "./seen";
import type { AmbientBot, AmbientWait } from "./types";
import type { MarkReaction, MarkState } from "@/components/mascot-engine";

export const WAKE = Object.freeze({
  /** A finished turn that ran at least this long wakes the island. */
  longTaskMs: 2 * 60_000,
});

export type WakeKind = "question" | "approval" | "sign-in" | "review" | "needs-you" | "failed" | "long-done" | "scheduled";
/** The mascot's moment when it wakes the island. */
export type WakeMoment = "nudge" | "celebrate" | "worried";

const ASK: Record<AmbientWait, WakeKind> = {
  question: "question", approval: "approval", "sign-in": "sign-in", password: "sign-in", connect: "sign-in", review: "review", other: "needs-you",
};
const ORDER: readonly WakeKind[] = ["question", "approval", "sign-in", "review", "needs-you", "failed", "long-done", "scheduled"];

export const WAKE_EMOJI: Record<WakeKind, string> = {
  question: "🙋",
  approval: "✋",
  "sign-in": "🔑",
  review: "👀",
  "needs-you": "👋",
  failed: "😵",
  "long-done": "🎉",
  scheduled: "📬",
};

export const WAKE_MOMENT: Record<WakeKind, WakeMoment> = {
  question: "nudge", approval: "nudge", "sign-in": "nudge", review: "nudge", "needs-you": "nudge",
  failed: "worried", "long-done": "celebrate", scheduled: "celebrate",
};

/** The mascot's pose while it holds the island, and the moves it makes as it arrives. */
export const MOMENT_POSE: Record<WakeMoment, { state: MarkState; reactions: MarkReaction[] }> = {
  nudge: { state: "notifying", reactions: ["greet", "nod"] },
  celebrate: { state: "celebrate", reactions: ["hop", "cheer"] },
  worried: { state: "sad", reactions: ["startle", "lookAround"] },
};

/** Why this bot wakes the island, or null when it should stay quiet. `bot` is as attention() leaves it. */
export function wakeOf(bot: AmbientBot, seen: ReadonlySet<string>): WakeKind | null {
  if (bot.quiet) return null;
  if (bot.status === "needs-you") return ASK[bot.waits ?? "other"];
  if (!isFresh(bot, seen)) return null;
  if (bot.status === "error") return "failed";
  if (bot.scheduled) return "scheduled";
  return (bot.ran ?? 0) >= WAKE.longTaskMs ? "long-done" : null;
}

export interface Wake { bot: AmbientBot; kind: WakeKind }

/** Every bot that wakes the island, the most urgent first, then the newest. */
export function wakesOf(bots: readonly AmbientBot[], seen: ReadonlySet<string>): Wake[] {
  return bots
    .map((bot) => ({ bot, kind: wakeOf(bot, seen) }))
    .filter((wake): wake is Wake => wake.kind !== null)
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.bot.at - a.bot.at || a.bot.name.localeCompare(b.bot.name));
}

/** What waits behind the first: each ask counts once per ask, everything else once. */
export const wakeCount = (wakes: readonly Wake[]): number => wakes.reduce((sum, { bot }) => sum + (bot.status === "needs-you" ? Math.max(1, bot.asks) : 1), 0);
