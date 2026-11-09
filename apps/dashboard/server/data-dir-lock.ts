// One writer per data folder. The stores here keep their state in memory and write it back (billing/json-store.ts), so a
// second process on the same folder would act on records the first one changed: an owner's cancelled deletion included.
import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

const held = new Set<string>();

export class DataDirLockedError extends Error {
  constructor() { super("Another account service is already using this data folder. Stop it first; two writers would overwrite each other's records."); this.name = "DataDirLockedError"; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Takes the folder's lock or throws DataDirLockedError; a lock left by a process that is gone on this host is taken over. */
export function lockDataDir(dataDir: string): () => void {
  const dir = resolve(dataDir), path = join(dir, ".writer.lock");
  if (held.has(dir)) throw new DataDirLockedError();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try { writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() })); } finally { closeSync(fd); }
      held.add(dir);
      let released = false;
      return () => { if (released) return; released = true; held.delete(dir); rmSync(path, { force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid?: unknown; host?: unknown } = {};
      try { owner = JSON.parse(readFileSync(path, "utf8")); } catch {}
      // an unreadable lock is one a crash left half written
      const unreadable = typeof owner.pid !== "number" && Date.now() - statSync(path).mtimeMs > 60_000;
      const stale = unreadable || (owner.host === hostname() && typeof owner.pid === "number" && owner.pid !== process.pid && !alive(owner.pid));
      if (!stale) throw new DataDirLockedError();
      rmSync(path, { force: true });
    }
  }
  throw new DataDirLockedError();
}
