import { compareVpsContainerStarts } from "./vps-container-start.ts";
import { createVpsLifecycleManager, type VpsLifecycleResource, type VpsLifecycleScreen, type VpsLifecycleStage, type VpsLifecycleTarget } from "./vps-lifecycle.ts";
import { createVpsLifecycleStore } from "./vps-lifecycle-store.ts";
import type { VpsLifecyclePolicy } from "./vps-config.ts";
import type { VpsComputerStatus } from "./vps-computer.ts";
import type { IndependentScreenTarget } from "./shared-desktop-screens.ts";

interface VpsLifecycleHostDeps {
  file: string;
  environmentId: string;
  policy(): VpsLifecyclePolicy;
  allowed(target: VpsLifecycleTarget): boolean;
  busy(stage: VpsLifecycleStage, target: VpsLifecycleTarget, ownReservation: boolean): boolean;
  reserve(target: VpsLifecycleTarget): (() => void) | null;
  inspect(target: VpsLifecycleResource, signal?: AbortSignal): Promise<VpsComputerStatus>;
  observe(resource: VpsLifecycleResource): Promise<void>;
  checkScreen(target: VpsLifecycleTarget): Promise<boolean>;
  adoptScreen(resource: VpsLifecycleResource, screen: IndependentScreenTarget): void;
  withIdleScreen(target: VpsLifecycleTarget, operation: (stillIdle: () => boolean) => Promise<void>): Promise<boolean>;
  closeBrowser(target: VpsLifecycleTarget, stillAllowed: () => boolean, signal: AbortSignal): Promise<void>;
  closeScreen(target: VpsLifecycleTarget): Promise<boolean>;
  stopComputer(target: VpsLifecycleTarget, stillAllowed: () => boolean, signal: AbortSignal): Promise<void>;
  completed(stage: VpsLifecycleStage, target: VpsLifecycleTarget): void;
  failed(target: VpsLifecycleTarget | undefined, error: unknown, retryInMs: number | null): void;
}

const identity = (target: VpsLifecycleResource) => JSON.stringify([target.sshAlias, target.ownerId, target.containerId]);

export function createVpsLifecycleHost(deps: VpsLifecycleHostDeps) {
  const reservations = new Set<string>();
  let closed = false;
  let closing: Promise<void> | undefined;
  let reconciling: Promise<void> | undefined;
  const reconcileAbort = new AbortController();
  const current = (target: VpsLifecycleTarget) => !closed && deps.allowed(target);
  const manager = createVpsLifecycleManager({
    policy: deps.policy,
    ...createVpsLifecycleStore(deps.file, deps.environmentId),
    current,
    busy: (stage, target) => deps.busy(stage, target, reservations.has(identity(target))),
    perform: async (stage, target, stillAllowed, signal) => {
      if (!current(target)) return "gone";
      if (!stillAllowed()) return "busy";
      const release = deps.reserve(target);
      if (!release) return "busy";
      const key = identity(target);
      reservations.add(key);
      try {
        const status = await deps.inspect(target, signal);
        if (!status.daemonUp) throw new Error(status.problem ?? "The VPS computer could not be inspected");
        if (!current(target) || status.container_id !== target.containerId || (target.startedAt && (!status.container_started_at || compareVpsContainerStarts(status.container_started_at, target.startedAt) !== 0)) || status.managed !== true) return "gone";
        if (!stillAllowed() || signal.aborted) return "busy";
        if (status.container === "stopped" || status.container === "missing") return "done";
        if (!status.ready) throw new Error(status.problem ?? "The VPS desktop ownership and isolation could not be verified");
        if (stage === "browser") {
          if (target.screen) {
            const performed = await deps.withIdleScreen(target, async stillIdle => {
              const allowed = () => stillAllowed() && stillIdle() && !signal.aborted;
              if (allowed()) await deps.closeBrowser(target, allowed, signal);
            });
            return performed ? "done" : "busy";
          }
          await deps.closeBrowser(target, stillAllowed, signal);
        } else if (stage === "screen" && target.screen) {
          if (!await deps.closeScreen(target)) return "busy";
        } else await deps.stopComputer(target, stillAllowed, signal);
        return "done";
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "vps_action_cancelled" || signal.aborted) return "busy";
        if (code === "vps_container_changed") return "gone";
        throw error;
      } finally { reservations.delete(key); release(); }
    },
    completed: deps.completed,
    failed: deps.failed,
  });
  async function reconcileResources(): Promise<void> {
    await manager.ready;
    const snapshot = manager.snapshot();
    const resources = snapshot.entries.filter(entry => !entry.target.botId);
    for (const entry of resources) {
      if (closed) return;
      const target = entry.target;
      if (!deps.allowed(target)) { manager.cancel(target); continue; }
      try {
        const status = await deps.inspect(target, reconcileAbort.signal);
        if (!deps.allowed(target)) continue;
        if (!status.daemonUp) throw new Error(status.problem ?? "The VPS computer could not be inspected");
        if (status.container_id !== target.containerId || (target.startedAt && (!status.container_started_at || compareVpsContainerStarts(status.container_started_at, target.startedAt) !== 0)) || status.container === "missing") { manager.cancel(target); continue; }
        if (!status.ready || status.managed !== true) continue;
        await deps.observe(target);
        manager.observe(target);
        for (const record of snapshot.entries.filter(record => record.target.botId && identity(record.target) === identity(target))) {
          if (!deps.allowed(record.target)) continue;
          if (record.target.screen) {
            if (!await deps.checkScreen(record.target) || !deps.allowed(record.target)) continue;
            deps.adoptScreen(target, record.target.screen);
          }
          manager.observeScreen(target, { botId: record.target.botId!, ...(record.target.screen ? { screen: record.target.screen } : {}) });
        }
      } catch (error) { if (!closed) deps.failed(target, error, null); }
    }
    await manager.flush();
  }
  return {
    ready: manager.ready,
    observe: (target: VpsLifecycleResource) => manager.observe(target),
    observeScreen: (target: VpsLifecycleResource, screen: VpsLifecycleScreen) => manager.observeScreen(target, screen),
    activity: (target: VpsLifecycleResource, screen?: VpsLifecycleScreen) => manager.activity(target, screen),
    cancel: manager.cancel,
    forgetScreen: manager.forgetScreen,
    configure: manager.configure,
    snapshot: manager.snapshot,
    flush: manager.flush,
    reconcile() { return reconciling ??= reconcileResources().finally(() => { reconciling = undefined; }); },
    close() {
      closed = true; reconcileAbort.abort();
      return closing ??= (async () => { const completion = manager.close(); await Promise.allSettled([completion, reconciling]); await completion; })();
    },
  };
}
