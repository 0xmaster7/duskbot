// What the island's emoji says for the whole team, and the order bots are listed in: whoever needs the person first.
import type { AmbientBot, AmbientStatus } from "./types";

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

const RANK: Record<AmbientStatus, number> = { "needs-you": 0, error: 1, talking: 2, working: 3, thinking: 4, done: 5, idle: 6 };
const BUSY = new Set<AmbientStatus>(["thinking", "working", "talking"]);

export const isBusy = (status: AmbientStatus) => BUSY.has(status);

/** Bots in the order the panel lists them: needs you, then failed, then busy, then unread, then the rest by recency. */
export function rankBots(bots: readonly AmbientBot[]): AmbientBot[] {
  return [...bots].sort((a, b) => RANK[a.status] - RANK[b.status] || b.at - a.at || a.name.localeCompare(b.name));
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
