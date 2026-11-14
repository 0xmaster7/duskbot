import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export interface UsageSignalsChoice { enabled: boolean }

/** the one "help improve dusk bot" switch: usage counts, the scrubbed notes about how sessions went, and (on the
 * desktop) crash reports. off until the person turns it on; DUSK_USAGE_SIGNALS=off keeps it off. */
export function createUsageSignalsSwitch(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const file = join(dataDir, "usage-signals.json");
  let on = false;
  // the salt for hashing bot, chat and routine ids in usage records; it never leaves this file
  let salt = "";
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { enabled?: unknown; salt?: unknown };
    on = saved.enabled === true;
    if (typeof saved.salt === "string" && /^[A-Za-z0-9_-]{22,}$/.test(saved.salt)) salt = saved.salt;
  } catch {}
  const write = () => writeFileAtomic(file, JSON.stringify({ enabled: on, salt }), { mode: 0o600 });
  const enabled = () => on && env.DUSK_USAGE_SIGNALS !== "off";
  return {
    enabled,
    choice: (): UsageSignalsChoice => ({ enabled: enabled() }),
    set(next: Partial<UsageSignalsChoice>) {
      if (typeof next.enabled === "boolean") on = next.enabled;
      write();
    },
    salt(): string {
      if (!salt) { salt = randomBytes(18).toString("base64url"); try { write(); } catch {} }
      return salt;
    },
  };
}
