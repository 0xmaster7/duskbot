import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export interface UsageSignalsChoice { enabled: boolean; summaries: boolean }

/** what this workspace shares with its dashboard reports: usage stats, and the summaries written when a chat goes badly.
 * Both on unless the desktop's data sharing settings (or DUSK_USAGE_SIGNALS=off) say otherwise; summaries need stats. */
export function createUsageSignalsSwitch(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const file = join(dataDir, "usage-signals.json");
  let choice: UsageSignalsChoice = { enabled: true, summaries: true };
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<UsageSignalsChoice>;
    choice = { enabled: saved.enabled !== false, summaries: saved.summaries !== false };
  } catch {}
  const enabled = () => choice.enabled && env.DUSK_USAGE_SIGNALS !== "off";
  return {
    enabled,
    summaries: () => enabled() && choice.summaries,
    choice: (): UsageSignalsChoice => ({ enabled: enabled(), summaries: enabled() && choice.summaries }),
    set(next: Partial<UsageSignalsChoice>) {
      choice = { enabled: next.enabled ?? choice.enabled, summaries: next.summaries ?? choice.summaries };
      writeFileAtomic(file, JSON.stringify(choice), { mode: 0o600 });
    },
  };
}
