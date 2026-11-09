// What the island's emoji says for the whole team, and the order bots are listed in: whoever needs the person first.
import type { AmbientBot, AmbientStatus, AmbientWait } from "./types";

export type Mood = "idle" | "thinking" | "working" | "talking" | "needs-you" | "done" | "celebrate" | "error";

export const MOOD_EMOJI: Record<Mood, string> = {
  idle: "😊",
  thinking: "🤔",
  working: "🛠️",
  talking: "💬",
  "needs-you": "🙋",
  done: "✅",
  celebrate: "🎉",
  error: "😵",
};

/** A bot that just finished a turn is cheered this long before the island settles. */
export const CELEBRATE_MS = 2600;

const RANK: Record<AmbientStatus, number> = { "needs-you": 0, error: 3, talking: 4, working: 5, thinking: 6, done: 7, idle: 8 };
const WAITS: Record<AmbientWait, number> = { question: 0, approval: 1, "sign-in": 2, password: 2, connect: 2, review: 2, other: 2 };

/** Lower is sooner: a question, an approval, anything else waiting on the person, a failure, then the rest. */
export const urgency = (bot: AmbientBot): number => (bot.status === "needs-you" ? WAITS[bot.waits ?? "other"] : RANK[bot.status]);
const BUSY = new Set<AmbientStatus>(["thinking", "working", "talking"]);

export const isBusy = (status: AmbientStatus) => BUSY.has(status);

/** Bots in the order the panel lists them: questions, approvals, other asks, failures, busy, unread, then the rest by
 * recency. */
export function rankBots(bots: readonly AmbientBot[]): AmbientBot[] {
  return [...bots].sort((a, b) => urgency(a) - urgency(b) || b.at - a.at || a.name.localeCompare(b.name));
}

/** Everything that waits on the person: each ask, and each bot stopped on a failure. */
export function waitingCount(bots: readonly AmbientBot[]): number {
  return bots.reduce((sum, bot) => sum + (bot.status === "needs-you" ? Math.max(1, bot.asks) : bot.status === "error" ? 1 : 0), 0);
}

/** Bots that went from a running turn to resting, unread or idle since the last summary. */
export function finishedSince(before: readonly AmbientBot[] | null, after: readonly AmbientBot[]): string[] {
  if (!before) return [];
  const was = new Map(before.map((bot) => [bot.id, bot.status]));
  return after.filter((bot) => isBusy(was.get(bot.id) ?? "idle") && (bot.status === "done" || bot.status === "idle")).map((bot) => bot.id);
}

/** The team's mood: anyone waiting on the person wins, then a failure, then a fresh finish, then what the busiest is doing. */
export function moodOf(bots: readonly AmbientBot[], celebrating = false): Mood {
  const has = (status: AmbientStatus) => bots.some((bot) => bot.status === status);
  if (has("needs-you")) return "needs-you";
  if (has("error")) return "error";
  if (celebrating) return "celebrate";
  if (has("talking")) return "talking";
  if (has("working")) return "working";
  if (has("thinking")) return "thinking";
  if (has("done")) return "done";
  return "idle";
}

/** The bot the collapsed island shows on its left: the one the mood is about, else the newest. */
export function focusBot(bots: readonly AmbientBot[]): AmbientBot | null {
  return rankBots(bots)[0] ?? null;
}

/** Bots in the person's dock order; new bots join at the end in the app's order. */
export function dockOrder(bots: readonly AmbientBot[], order: readonly string[]): AmbientBot[] {
  const at = new Map(order.map((id, index) => [id, index]));
  return bots.map((bot, index) => ({ bot, index })).sort((a, b) => (at.get(a.bot.id) ?? order.length + a.index) - (at.get(b.bot.id) ?? order.length + b.index)).map(({ bot }) => bot);
}

/** "now", "4m", "2h", "3d" in the person's language: short enough for the island's rows. */
export function shortAgo(at: number, now: number, lang: string, nowWord: string): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return nowWord;
  const minutes = Math.round(seconds / 60), hours = Math.round(minutes / 60), days = Math.round(hours / 24);
  const [value, unit] = minutes < 60 ? [minutes, "minute"] : hours < 24 ? [hours, "hour"] : [days, "day"];
  try {
    return new Intl.NumberFormat(lang || undefined, { style: "unit", unit, unitDisplay: "narrow" }).format(value);
  } catch {
    return `${value}${unit[0]}`;
  }
}
