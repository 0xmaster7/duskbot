const MAX_STOP_FAILURES = 3;
const MAX_RETRY_MS = 60 * 60_000;

export interface VpsIdleTarget {
  ownerId: string;
  sshAlias: string;
  containerId: string;
}

export interface VpsIdleDeps {
  idleMs(): number;
  current(target: VpsIdleTarget): boolean;
  busy(target: VpsIdleTarget): boolean;
  /** Reserve the target's lifecycle lane and recheck busy state before stopping. `stillIdle` revokes a pending stop
   * after activity, configuration changes or shutdown; the stop must also pin the inspected container identity. */
  stop(target: VpsIdleTarget, stillIdle: () => boolean): Promise<"stopped" | "busy" | "gone">;
  stopped?(target: VpsIdleTarget): void;
  failed?(target: VpsIdleTarget, error: unknown, retryInMs: number | null): void;
}

interface IdleEntry {
  target: Readonly<VpsIdleTarget>;
  lastActivityAt: number;
  revision: number;
  failures: number;
  busySeen: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const targetKey = (target: Pick<VpsIdleTarget, "ownerId" | "sshAlias">) => JSON.stringify([target.sshAlias, target.ownerId]);

export function createVpsIdleManager(deps: VpsIdleDeps) {
  const entries = new Map<string, IdleEntry>();
  const stopping = new Set<string>();
  let closed = false;
  const windowMs = () => {
    const value = deps.idleMs();
    if (!Number.isFinite(value) || value < 0) throw new Error("VPS idle timeout must be zero or positive");
    return value;
  };
  const clear = (entry: IdleEntry) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  };
  const retire = (key: string, entry: IdleEntry) => {
    clear(entry);
    entry.revision += 1;
    if (entries.get(key) === entry) entries.delete(key);
  };
  const arm = (key: string, entry: IdleEntry, delayMs: number) => {
    clear(entry);
    if (closed || windowMs() === 0 || entries.get(key) !== entry) return;
    entry.timer = setTimeout(() => void expire(key, entry), Math.max(0, delayMs));
    entry.timer.unref?.();
  };
  const renew = (key: string, entry: IdleEntry) => {
    entry.lastActivityAt = Date.now();
    entry.revision += 1;
    entry.failures = 0;
    entry.busySeen = false;
    arm(key, entry, windowMs());
  };
  const expire = async (key: string, entry: IdleEntry) => {
    entry.timer = undefined;
    const revision = entry.revision;
    const stillIdle = () => !closed && entries.get(key) === entry && entry.revision === revision
      && windowMs() > 0 && deps.current(entry.target);
    try {
      if (!stillIdle()) { if (entries.get(key) === entry) retire(key, entry); return; }
      if (stopping.has(key) || deps.busy(entry.target)) {
        entry.busySeen = true;
        arm(key, entry, windowMs() / 10);
        return;
      }
      if (entry.busySeen) { renew(key, entry); return; }
      stopping.add(key);
      let outcome: "stopped" | "busy" | "gone";
      try { outcome = await deps.stop(entry.target, stillIdle); }
      finally { stopping.delete(key); }
      if (!stillIdle()) return;
      if (outcome === "busy") { renew(key, entry); return; }
      retire(key, entry);
      if (outcome === "stopped") deps.stopped?.(entry.target);
    } catch (error) {
      if (!stillIdle()) return;
      entry.failures += 1;
      const retryInMs = entry.failures < MAX_STOP_FAILURES
        ? Math.min(windowMs() * 2 ** (entry.failures - 1), Math.max(windowMs(), MAX_RETRY_MS)) : null;
      if (retryInMs !== null) arm(key, entry, retryInMs);
      deps.failed?.(entry.target, error, retryInMs);
    }
  };

  const activity = (target: VpsIdleTarget): void => {
    if (closed) return;
    const key = targetKey(target);
    let entry = entries.get(key);
    if (entry && entry.target.containerId !== target.containerId) { retire(key, entry); entry = undefined; }
    if (!entry) {
      entry = { target: Object.freeze({ ...target }), lastActivityAt: 0, revision: 0, failures: 0, busySeen: false };
      entries.set(key, entry);
    }
    renew(key, entry);
  };

  return {
    /** Only real computer actions, manual wake and handing control back renew an idle window. Read-only watch and
     * status requests never call this. Targets sharing an owner and alias share exactly one timer. */
    activity,
    /** Adopt a running owned computer once after a server restart. Repeated status and watch observations never
     * renew its deadline or restart exhausted retries. */
    observe(target: VpsIdleTarget): void {
      if (closed) return;
      const entry = entries.get(targetKey(target));
      if (entry?.target.containerId === target.containerId) return;
      activity(target);
    },
    cancel(target: Pick<VpsIdleTarget, "ownerId" | "sshAlias">): void {
      const key = targetKey(target), entry = entries.get(key);
      if (entry) retire(key, entry);
    },
    configure(): void {
      for (const [key, entry] of entries) {
        entry.revision += 1;
        arm(key, entry, entry.lastActivityAt + windowMs() - Date.now());
      }
    },
    close(): void {
      closed = true;
      for (const [key, entry] of entries) retire(key, entry);
    },
  };
}
