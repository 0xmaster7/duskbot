import type { BotReport, ComputerReport, Freshness } from "../../../../shared/dashboard-protocol.ts";

/** the moods a bot on the dashboard can be in; each is a state of the mascot engine */
export type BotMood = "working" | "sleeping" | "waking" | "drowsy" | "idle";

const DAY = 86_400_000;

/** what a bot is doing, as a mood: asleep when its workspace is unreachable or its computer sleeps, working while it
 * runs a turn, waking while its computer starts, drowsy after a day of nothing, otherwise awake and waiting */
export function botMood(bot: Pick<BotReport, "busy" | "lastActiveAt">, opts: { computer?: ComputerReport["state"] | null; freshness?: Freshness; now?: number } = {}): BotMood {
  if (opts.freshness === "offline" || opts.freshness === "waiting") return "sleeping";
  if (bot.busy) return "working";
  if (opts.computer === "starting") return "waking";
  if (opts.computer === "asleep") return "sleeping";
  if (bot.lastActiveAt !== null && (opts.now ?? Date.now()) - bot.lastActiveAt > DAY) return "drowsy";
  return "idle";
}

/** the words for a mood, shown next to the bot so the colour never stands alone */
export const MOOD_LABEL: Record<BotMood, string> = { working: "working", sleeping: "asleep", waking: "waking up", drowsy: "resting", idle: "waiting" };
