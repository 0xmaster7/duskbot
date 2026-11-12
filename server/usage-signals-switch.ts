import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export interface UsageSignalsChoice { enabled: boolean; summaries: boolean }

/** what this workspace shares with its dashboard reports: usage stats, and the summaries written when a chat goes badly.
 * Both on unless the desktop's data sharing settings (or DUSK_USAGE_SIGNALS=off) say otherwise; summaries need stats. */
export function createUsageSignalsSwitch(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const file = join(dataDir, "usage-signals.json");
  let choice: UsageSignalsChoice = { enabled: true, summaries: true };
  // the salt for hashing bot, chat and routine ids in usage records; it never leaves this file
  let salt = "";
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<UsageSignalsChoice> & { salt?: unknown };
    choice = { enabled: saved.enabled !== false, summaries: saved.summaries !== false };
    if (typeof saved.salt === "string" && /^[A-Za-z0-9_-]{22,}$/.test(saved.salt)) salt = saved.salt;
  } catch {}
  const write = () => writeFileAtomic(file, JSON.stringify({ ...choice, salt }), { mode: 0o600 });
  const enabled = () => choice.enabled && env.DUSK_USAGE_SIGNALS !== "off";
  return {
    enabled,
    summaries: () => enabled() && choice.summaries,
    choice: (): UsageSignalsChoice => ({ enabled: enabled(), summaries: enabled() && choice.summaries }),
    set(next: Partial<UsageSignalsChoice>) {
      choice = { enabled: next.enabled ?? choice.enabled, summaries: next.summaries ?? choice.summaries };
      write();
    },
    salt(): string {
      if (!salt) { salt = randomBytes(18).toString("base64url"); try { write(); } catch {} }
      return salt;
    },
  };
}
