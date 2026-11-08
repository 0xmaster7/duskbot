import type { ActivityReport } from "../../../shared/dashboard-protocol";
import { dayKey } from "./format";

export const APP_LINK = "openmausbot://";
export const DOWNLOAD_URL = "https://openmausbot.com/download";
export const API_DOCS = "https://github.com/SiddDevZ/OpenMausBot/blob/custom/docs/bot-api.md";

export function monthTotals(activity: ActivityReport | undefined, now: number) {
  const month = dayKey(now).slice(0, 7);
  let turns = 0, tokens = 0, cost = 0, priced = false;
  for (const d of activity?.days ?? []) {
    if (!d.date.startsWith(month)) continue;
    turns += d.turns; tokens += d.tokens;
    if (d.costUsd !== null) { cost += d.costUsd; priced = true; }
  }
  return { turns, tokens, costUsd: priced ? cost : null };
}
