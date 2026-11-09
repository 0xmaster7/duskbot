// Every lifecycle action on a Boat home, one JSON line each, appended and never rewritten: who asked, why, when. A deletion
// also raises an alert to the operator. Lines carry ids and fixed codes only, never a secret, a token or an email address.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type AuditActor = "reconciler" | "owner" | "billing" | "operator" | "edge" | "system";
export interface AuditEntry { at: number; cloudId: string; action: string; actor: AuditActor; reason: string; serverId?: string | null; detail?: Record<string, string | number | boolean | null> }

const SAFE = /^[A-Za-z0-9_.:-]{0,120}$/;

export function createAudit(options: { dataDir: string; now?: () => number; alert?: (entry: AuditEntry) => void }) {
  const path = join(options.dataDir, "boat-audit.jsonl"), now = options.now ?? Date.now;
  if (!existsSync(path)) closeSync(openSync(path, "a", 0o600));
  return {
    record(entry: Omit<AuditEntry, "at">): AuditEntry {
      // never throws: an audit line must not undo the lifecycle step it records; anything outside the safe set is masked
      const clean = (value: string) => SAFE.test(value) ? value : value.slice(0, 120).replace(/[^A-Za-z0-9_.:-]/g, "_");
      const detail = entry.detail ? Object.fromEntries(Object.entries(entry.detail).map(([k, v]) => [clean(k), typeof v === "string" ? clean(v) : v])) : undefined;
      const line: AuditEntry = { at: now(), ...entry, action: clean(entry.action), reason: clean(entry.reason), serverId: entry.serverId == null ? entry.serverId : clean(entry.serverId), ...(detail ? { detail } : {}) };
      appendFileSync(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      if (/^delete|deleted$/.test(entry.action)) {
        console.warn(`boat: ALERT ${entry.action} cloud ${entry.cloudId} by ${entry.actor} (${entry.reason})`);
        try { options.alert?.(line); } catch { console.warn("boat: deletion alert failed"); }
      }
      return line;
    },
    entries(cloudId?: string): AuditEntry[] {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as AuditEntry).filter(e => cloudId === undefined || e.cloudId === cloudId);
    },
  };
}
export type Audit = ReturnType<typeof createAudit>;
