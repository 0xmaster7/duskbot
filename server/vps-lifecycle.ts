import { isValidSshAlias, vpsLifecyclePolicy, type VpsLifecyclePolicy } from "./vps-config.ts";
import { independentScreenExecArgs, independentScreenTarget, type IndependentScreenTarget, type ScreenContainer } from "./shared-desktop-screens.ts";
import { vpsContainerStartedAt } from "./vps-container-start.ts";

export type VpsLifecycleStage = "browser" | "screen" | "computer";
export interface VpsLifecycleResource extends ScreenContainer { startedAt?: string }
export interface VpsLifecycleScreen { botId: string; screen?: IndependentScreenTarget }
export type VpsLifecycleTarget = VpsLifecycleResource & Partial<VpsLifecycleScreen>;
export interface VpsLifecycleRecord {
  target: VpsLifecycleTarget;
  lastActivityAt: number;
  epoch: number;
  completed: VpsLifecycleStage[];
  failures: number;
  retryAt?: number;
  failedStage?: VpsLifecycleStage;
  exhausted?: boolean;
}
export interface VpsLifecycleState { version: 1; entries: VpsLifecycleRecord[] }
export interface VpsLifecycleDeps {
  policy(): VpsLifecyclePolicy;
  load(): VpsLifecycleState | null | Promise<VpsLifecycleState | null>;
  save(state: VpsLifecycleState): void | Promise<void>;
  current(target: VpsLifecycleTarget): boolean;
  busy(stage: VpsLifecycleStage, target: VpsLifecycleTarget): boolean;
  /** Recheck the epoch, ownership and holds inside the reserved lifecycle lane before any guest mutation. */
  perform(stage: VpsLifecycleStage, target: VpsLifecycleTarget, stillAllowed: () => boolean, signal: AbortSignal): Promise<"done" | "busy" | "gone">;
  completed?(stage: VpsLifecycleStage, target: VpsLifecycleTarget): void;
  failed?(target: VpsLifecycleTarget | undefined, error: unknown, retryInMs: number | null): void;
  now?(): number;
  retryMs?: readonly number[];
  busyRetryMs?: number;
  coalesceMs?: number;
}

const stages: VpsLifecycleStage[] = ["browser", "screen", "computer"];
const id = /^[A-Za-z0-9_-]{1,160}$/;
const resourceKey = (target: Pick<ScreenContainer, "sshAlias" | "ownerId">) => JSON.stringify([target.sshAlias, target.ownerId]);
const entryKey = (target: VpsLifecycleTarget) => JSON.stringify([target.sshAlias, target.ownerId, target.botId ?? null]);
const sameResource = (left: VpsLifecycleResource, right: VpsLifecycleResource) => resourceKey(left) === resourceKey(right);
const clone = <T>(value: T): T => structuredClone(value);
export function vpsLifecycleDurationMs(stage: VpsLifecycleStage, policy: VpsLifecyclePolicy): number {
  return policy[`${stage}IdleMinutes`] * 60_000;
}

export function validateVpsLifecycleTarget(target: VpsLifecycleTarget): VpsLifecycleTarget {
  if (!target || typeof target !== "object" || !isValidSshAlias(target.sshAlias) || !id.test(target.ownerId) || !/^[a-f0-9]{64}$/i.test(target.containerId)
    || (target.botId !== undefined && !id.test(target.botId)) || (target.startedAt !== undefined && !vpsContainerStartedAt(target.startedAt))) throw new Error("Invalid VPS lifecycle target");
  if (target.screen) {
    if (!target.botId || target.screen.botId !== target.botId) throw new Error("Invalid VPS lifecycle bot screen");
    independentScreenExecArgs(target.containerId, "ensure", target.screen);
  }
  return { ownerId: target.ownerId, sshAlias: target.sshAlias, containerId: target.containerId, ...(target.startedAt ? { startedAt: target.startedAt } : {}),
    ...(target.botId ? { botId: target.botId } : {}), ...(target.screen ? { screen: independentScreenTarget(target.screen.botId, target.screen.display, target.screen.generation) } : {}) };
}

export function validateVpsLifecycleState(value: unknown): VpsLifecycleState {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("entries" in value) || !Array.isArray(value.entries) || value.entries.length > 10_000) throw new Error("Invalid VPS lifecycle state");
  const seen = new Set<string>();
  const entries = value.entries.map((raw: VpsLifecycleRecord) => {
    const target = validateVpsLifecycleTarget(raw.target);
    const key = entryKey(target);
    if (seen.has(key) || !Number.isSafeInteger(raw.lastActivityAt) || raw.lastActivityAt < 0 || !Number.isSafeInteger(raw.epoch) || raw.epoch < 0
      || !Number.isInteger(raw.failures) || raw.failures < 0 || raw.failures > 100 || !Array.isArray(raw.completed) || raw.completed.some(stage => !stages.includes(stage))
      || (raw.retryAt !== undefined && (!Number.isSafeInteger(raw.retryAt) || raw.retryAt < 0)) || (raw.failedStage !== undefined && !stages.includes(raw.failedStage))
      || (raw.exhausted !== undefined && typeof raw.exhausted !== "boolean")) throw new Error("Invalid VPS lifecycle record");
    seen.add(key);
    return { target, lastActivityAt: raw.lastActivityAt, epoch: raw.epoch, completed: [...raw.completed], failures: raw.failures,
      ...(raw.retryAt !== undefined ? { retryAt: raw.retryAt } : {}), ...(raw.failedStage ? { failedStage: raw.failedStage } : {}), ...(raw.exhausted !== undefined ? { exhausted: raw.exhausted } : {}) };
  });
  if (entries.some(entry => entry.target.botId && !entries.some(resource => !resource.target.botId && sameResource(entry.target, resource.target)))) throw new Error("VPS lifecycle screen is missing its resource");
  return { version: 1, entries };
}

interface Entry extends VpsLifecycleRecord { observed: boolean; pending?: Promise<void>; abort?: AbortController }
export function createVpsLifecycleManager(deps: VpsLifecycleDeps) {
  const entries = new Map<string, Entry>();
  const now = deps.now ?? Date.now;
  const retries = deps.retryMs ?? [60_000, 300_000];
  const busyRetryMs = deps.busyRetryMs ?? 30_000;
  const coalesceMs = deps.coalesceMs ?? 1000;
  let initialized = false, closed = false, blocked = false, durable = true, revision = 0, saved = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, saveTimer: ReturnType<typeof setTimeout> | undefined, saving: Promise<void> | undefined;
  const commands: Array<() => void> = [];
  const active = new Set<Promise<void>>();
  const snapshot = (): VpsLifecycleState => ({ version: 1, entries: [...entries.values()].map(({ observed: _observed, pending: _pending, abort: _abort, ...entry }) => clone(entry)) });
  const policy = () => vpsLifecyclePolicy({ lifecycle: deps.policy() });
  const dirty = () => {
    revision += 1;
    if (saveTimer || closed || blocked) return;
    saveTimer = setTimeout(() => { saveTimer = undefined; void flush().then(schedule, () => {}); }, coalesceMs);
    saveTimer.unref?.();
  };
  async function flush(): Promise<void> {
    await ready;
    clearTimeout(saveTimer); saveTimer = undefined;
    if (blocked) throw new Error("VPS lifecycle state is unavailable");
    if (saving) return saving;
    const write = async () => {
      try {
        while (saved < revision) {
          const checkpoint = revision;
          await deps.save(snapshot());
          saved = checkpoint;
        }
        durable = true;
      } catch (error) { durable = false; deps.failed?.(undefined, error, null); throw error; }
    };
    saving = write().finally(() => { saving = undefined; });
    return saving;
  }
  const mutate = (operation: () => void) => {
    if (closed || blocked) return;
    if (!initialized) { if (commands.length >= 10_000) throw new Error("Too many pending VPS lifecycle observations"); commands.push(operation); }
    else { operation(); schedule(); }
  };
  const invalidate = (entry: Entry) => { entry.epoch += 1; entry.abort?.abort(); };
  function adopt(resource: VpsLifecycleResource, descriptor?: VpsLifecycleScreen): Entry {
    const target = validateVpsLifecycleTarget({ ...resource, ...descriptor });
    const key = entryKey(target);
    let entry = entries.get(key);
    if (!entry) {
      const parent = entries.get(entryKey(resource));
      entry = { target, lastActivityAt: parent?.lastActivityAt ?? now(), epoch: 0, completed: [], failures: 0, observed: true };
      entries.set(key, entry); dirty();
    } else {
      if (JSON.stringify(entry.target) !== JSON.stringify(target)) {
        invalidate(entry); entry.target = target; entry.completed = []; entry.failures = 0; entry.exhausted = false; delete entry.retryAt; delete entry.failedStage; dirty();
      }
      entry.observed = true;
    }
    return entry;
  }
  function renew(entry: Entry, timestamp: number) {
    invalidate(entry); entry.lastActivityAt = Math.max(entry.lastActivityAt, timestamp); entry.completed = []; entry.failures = 0; entry.exhausted = false; delete entry.retryAt; delete entry.failedStage; dirty();
  }
  function dueStage(entry: Entry): { stage: VpsLifecycleStage; at: number } | undefined {
    const values = policy();
    const eligible = entry.target.botId ? ["screen", "browser"] as const : ["computer"] as const;
    const due = eligible.filter(stage => values[`${stage}IdleMinutes`] > 0 && !entry.completed.includes(stage) && !(entry.exhausted && entry.failedStage === stage));
    const matured = due.find(stage => entry.lastActivityAt + vpsLifecycleDurationMs(stage, values) <= now());
    const stage = matured ?? due.at(-1);
    if (!stage) return;
    return { stage, at: Math.max(entry.lastActivityAt + vpsLifecycleDurationMs(stage, values), entry.failedStage && entry.failedStage !== stage ? 0 : entry.retryAt ?? 0) };
  }
  function run(entry: Entry, stage: VpsLifecycleStage) {
    const epoch = entry.epoch, target = clone(entry.target), abort = new AbortController();
    entry.abort = abort;
    const stillAllowed = () => !closed && !abort.signal.aborted && entries.get(entryKey(target)) === entry && entry.epoch === epoch
      && deps.current(target) && !deps.busy(stage, target) && dueStage(entry)?.stage === stage && (dueStage(entry)?.at ?? Infinity) <= now();
    const operation = Promise.resolve().then(async () => {
      try {
        await flush();
        if (!durable || !stillAllowed()) return;
        const outcome = await deps.perform(stage, target, stillAllowed, abort.signal);
        if (closed || abort.signal.aborted || entry.epoch !== epoch || entries.get(entryKey(target)) !== entry) return;
        if (outcome === "busy") { entry.retryAt = now() + busyRetryMs; entry.failedStage = stage; entry.failures = 0; entry.exhausted = false; dirty(); return; }
        if (outcome === "gone") { entry.observed = false; return; }
        const completed = stages.slice(0, stages.indexOf(stage) + 1);
        entry.completed = [...new Set([...entry.completed, ...completed])]; entry.failures = 0; delete entry.retryAt; delete entry.failedStage; dirty();
        if (stage === "computer") for (const related of entries.values()) if (sameResource(related.target, target)) { invalidate(related); related.completed = [...stages]; related.observed = false; }
        await flush();
        deps.completed?.(stage, target);
      } catch (error) {
        if (closed || abort.signal.aborted || entry.epoch !== epoch || entries.get(entryKey(target)) !== entry) return;
        entry.failures = entry.failedStage === stage ? entry.failures + 1 : 1;
        entry.failedStage = stage;
        const delay = retries[entry.failures - 1];
        entry.exhausted = delay === undefined;
        if (delay !== undefined) entry.retryAt = now() + delay; else delete entry.retryAt;
        dirty();
        deps.failed?.(target, error, delay ?? null);
      }
    });
    entry.pending = operation; active.add(operation);
    void operation.finally(() => { active.delete(operation); if (entry.pending === operation) { entry.pending = undefined; entry.abort = undefined; } schedule(); });
  }
  function schedule() {
    clearTimeout(timer); timer = undefined;
    if (!initialized || closed || blocked || !durable) return;
    let next = Infinity;
    const candidates = [...entries.values()].filter(entry => entry.observed && !entry.pending && ![...entries.values()].some(other => other.pending && sameResource(other.target, entry.target)))
      .flatMap(entry => { const due = dueStage(entry); return due ? [{ entry, ...due }] : []; })
      .sort((left, right) => stages.indexOf(right.stage) - stages.indexOf(left.stage) || left.at - right.at);
    for (const { entry, stage, at } of candidates) {
      if (entry.exhausted && entry.failedStage === stage) continue;
      if (!deps.current(entry.target)) { entry.observed = false; continue; }
      if (at > now()) { next = Math.min(next, at); continue; }
      if (deps.busy(stage, entry.target)) { entry.retryAt = now() + busyRetryMs; next = Math.min(next, entry.retryAt); continue; }
      if (active.size >= 2) break;
      if ([...entries.values()].some(other => other.pending && sameResource(other.target, entry.target))) continue;
      run(entry, stage);
    }
    if (Number.isFinite(next) && active.size < 2) {
      timer = setTimeout(schedule, Math.max(1, Math.min(2_147_483_647, next - now()))); timer.unref?.();
    }
  }
  const ready = Promise.resolve().then(() => deps.load()).then(state => {
    if (state) for (const record of validateVpsLifecycleState(state).entries) entries.set(entryKey(record.target), { ...record, observed: false });
    for (const entry of entries.values()) if (entry.lastActivityAt > now()) { entry.lastActivityAt = now(); delete entry.retryAt; dirty(); }
    for (const entry of entries.values()) if (!entry.target.botId) for (const child of entries.values()) if (child.target.botId && sameResource(entry.target, child.target) && entry.lastActivityAt < child.lastActivityAt) { entry.lastActivityAt = child.lastActivityAt; dirty(); }
  }, error => { blocked = true; deps.failed?.(undefined, error, null); }).catch(error => { blocked = true; deps.failed?.(undefined, error, null); }).then(() => {
    initialized = true;
    if (!blocked) for (const command of commands.splice(0)) command();
    commands.length = 0; schedule();
  });
  return {
    ready,
    observe(resource: VpsLifecycleResource) { const pinned = validateVpsLifecycleTarget(resource); mutate(() => { adopt(pinned); }); },
    observeScreen(resource: VpsLifecycleResource, descriptor: VpsLifecycleScreen) {
      const pinned = validateVpsLifecycleTarget({ ...resource, ...descriptor });
      const { botId: _botId, screen: _screen, ...physical } = pinned;
      mutate(() => { adopt(physical); adopt(physical, { botId: pinned.botId!, ...(pinned.screen ? { screen: pinned.screen } : {}) }); });
    },
    activity(resource: VpsLifecycleResource, descriptor?: VpsLifecycleScreen) {
      const pinned = validateVpsLifecycleTarget({ ...resource, ...descriptor }), timestamp = now();
      mutate(() => {
        const { botId: _botId, screen: _screen, ...physical } = pinned;
        renew(adopt(physical), timestamp);
        if (descriptor) renew(adopt(physical, { botId: pinned.botId!, ...(pinned.screen ? { screen: pinned.screen } : {}) }), timestamp);
      });
    },
    cancel(target: Pick<VpsLifecycleResource, "ownerId" | "sshAlias">) { mutate(() => { for (const [key, entry] of entries) if (sameResource(entry.target, target as VpsLifecycleResource)) { invalidate(entry); entries.delete(key); dirty(); } }); },
    forgetScreen(resource: VpsLifecycleResource, botId: string, expectedGeneration?: string) {
      const target = validateVpsLifecycleTarget({ ...resource, botId });
      mutate(() => {
        const key = entryKey(target), entry = entries.get(key);
        if (!entry || entry.target.containerId !== target.containerId || (expectedGeneration !== undefined && entry.target.screen?.generation !== expectedGeneration)) return;
        invalidate(entry); entries.delete(key); dirty();
      });
    },
    configure() { policy(); mutate(() => { for (const entry of entries.values()) { invalidate(entry); entry.exhausted = false; entry.failures = 0; delete entry.retryAt; delete entry.failedStage; } dirty(); }); },
    snapshot,
    async flush() { await flush(); schedule(); },
    async close() { closed = true; clearTimeout(timer); clearTimeout(saveTimer); await ready; for (const entry of entries.values()) entry.abort?.abort(); await Promise.allSettled(active); if (!blocked) await flush(); },
  };
}
