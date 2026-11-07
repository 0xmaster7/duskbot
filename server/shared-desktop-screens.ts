import { createHash, randomUUID } from "node:crypto";
import { isValidSshAlias } from "./config.ts";

export const INDEPENDENT_DISPLAYS = [2, 3, 4, 5] as const;
export type IndependentDisplay = typeof INDEPENDENT_DISPLAYS[number];
export type ScreenLeaseKind = "turn" | "hold" | "watch";

export interface ScreenContainer {
  sshAlias: string;
  ownerId: string;
  containerId: string;
}

export interface IndependentScreenTarget {
  botId: string;
  botHash: string;
  display: IndependentDisplay;
  viewerPort: number;
  cdpPort: number;
  socket: string;
  runtimeDir: string;
  chromiumProfile: string;
  generation: string;
}

export interface IndependentScreenLease {
  readonly target: IndependentScreenTarget;
  live(): boolean;
  release(): void;
  touch(): void;
}

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const GENERATION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CONTAINER = /^[a-f0-9]{64}$/i;
const QUEUE_LIMIT = 256;
const failure = (message: string, status = 409) => Object.assign(new Error(message), { status });

export function independentScreenTarget(botId: string, display: IndependentDisplay, generation: string = randomUUID()): IndependentScreenTarget {
  if (!ID.test(botId) || !INDEPENDENT_DISPLAYS.includes(display) || !GENERATION.test(generation)) throw failure("Invalid independent screen target", 400);
  const botHash = createHash("sha256").update(botId).digest("hex");
  const runtimeDir = `/run/user/1000/omb-screens/${display}`;
  return Object.freeze({ botId, botHash, display, viewerPort: 6900 + display, cdpPort: 9222 + display, runtimeDir, socket: `${runtimeDir}/cua.sock`,
    chromiumProfile: `/home/cua/.config/omb/screens/${botHash}/chromium`, generation });
}

export function independentScreenExecArgs(containerId: string, action: "version" | "reset" | "ensure" | "stop", target?: IndependentScreenTarget): string[] {
  if (!CONTAINER.test(containerId) || !["version", "reset", "ensure", "stop"].includes(action)) throw failure("Invalid independent screen operation", 400);
  const args = ["exec", "-u", "cua", containerId, "/usr/local/bin/omb-screen", action];
  if (action === "reset" || action === "version") {
    if (target) throw failure("This operation does not accept a screen target", 400);
    return args;
  }
  if (!target) throw failure("A screen target is required", 400);
  const canonical = independentScreenTarget(target.botId, target.display, target.generation);
  if (Object.keys(canonical).some(key => canonical[key as keyof IndependentScreenTarget] !== target[key as keyof IndependentScreenTarget])) {
    throw failure("Independent screen identity changed", 400);
  }
  return [...args, String(canonical.display), canonical.botHash, canonical.generation];
}

interface Request {
  botId: string;
  kind: ScreenLeaseKind;
  signal?: AbortSignal;
  resolve(lease: IndependentScreenLease): void;
  reject(error: unknown): void;
  abort?: () => void;
}
interface Slot {
  display: IndependentDisplay;
  target?: IndependentScreenTarget;
  cleanup?: IndependentScreenTarget;
  ready: boolean;
  pending?: Promise<void>;
  leases: Map<symbol, ScreenLeaseKind>;
  usedAt: number;
}
interface ContainerState {
  container: ScreenContainer;
  slots: Slot[];
  queue: Request[];
  abort: AbortController;
  initialized: boolean;
  initialization?: Promise<void>;
  closed: boolean;
  closing?: Promise<void>;
}
export interface SharedScreenHooks {
  reset(container: ScreenContainer, signal: AbortSignal): Promise<void>;
  start(container: ScreenContainer, target: IndependentScreenTarget, signal: AbortSignal): Promise<void>;
  stop(container: ScreenContainer, target: IndependentScreenTarget): Promise<void>;
  /** Close old viewers before its port can show another bot's profile. */
  revoke(container: ScreenContainer, target: IndependentScreenTarget): void;
  now?(): number;
}

export function createSharedScreenBroker(hooks: SharedScreenHooks) {
  const containers = new Map<string, ContainerState>();
  const now = hooks.now ?? Date.now;
  let closed = false;
  const key = (container: ScreenContainer) => {
    if (!isValidSshAlias(container.sshAlias) || !ID.test(container.ownerId) || !CONTAINER.test(container.containerId)) throw failure("Invalid shared computer identity", 400);
    return `${container.sshAlias}:${container.ownerId}:${container.containerId}`;
  };
  const finish = (state: ContainerState, request: Request, error?: unknown, lease?: IndependentScreenLease) => {
    const index = state.queue.indexOf(request);
    if (index < 0) return;
    state.queue.splice(index, 1);
    if (request.abort) request.signal?.removeEventListener("abort", request.abort);
    if (lease) request.resolve(lease);
    else request.reject(error ?? failure("Screen request failed", 503));
  };
  const failBot = (state: ContainerState, botId: string, error: unknown) => {
    for (const request of state.queue.slice()) if (request.botId === botId) finish(state, request, error);
  };
  function lease(state: ContainerState, slot: Slot, request: Request): IndependentScreenLease {
    const token = Symbol();
    const target = slot.target!;
    slot.leases.set(token, request.kind);
    slot.usedAt = now();
    return {
      target: Object.freeze({ ...target }),
      live: () => !state.closed && slot.target === target && slot.ready && slot.leases.has(token),
      release() { if (slot.leases.delete(token)) { slot.usedAt = now(); drain(state); } },
      touch() { if (!state.closed && slot.target === target && slot.leases.has(token)) slot.usedAt = now(); },
    };
  }
  function prepare(state: ContainerState, slot: Slot, botId: string) {
    const previous = slot.cleanup ?? slot.target;
    const target = independentScreenTarget(botId, slot.display);
    slot.target = target;
    slot.ready = false;
    slot.leases.clear();
    slot.usedAt = now();
    slot.cleanup = previous;
    const operation = Promise.resolve().then(async () => {
      if (previous) {
        hooks.revoke(state.container, previous);
        await hooks.stop(state.container, previous);
        slot.cleanup = undefined;
      }
      if (state.closed) throw failure("Shared screen broker closed", 503);
      try { await hooks.start(state.container, target, state.abort.signal); }
      catch (error) { slot.cleanup = target; throw error; }
      if (state.closed) throw failure("Shared screen broker closed", 503);
      slot.ready = true;
    });
    slot.pending = operation;
    void operation.catch(error => failBot(state, botId, error)).finally(() => {
      if (slot.pending === operation) slot.pending = undefined;
      drain(state);
    });
  }
  function drain(state: ContainerState) {
    if (state.closed || !state.queue.length) return;
    if (!state.initialized) {
      if (state.initialization) return;
      const initializing = Promise.resolve().then(() => hooks.reset(state.container, state.abort.signal));
      state.initialization = initializing;
      void initializing.then(() => { state.initialized = true; }, error => {
        for (const request of state.queue.slice()) finish(state, request, error);
      }).finally(() => { if (state.initialization === initializing) state.initialization = undefined; drain(state); });
      return;
    }
    for (const request of state.queue.slice()) {
      if (request.signal?.aborted) { finish(state, request, request.signal.reason ?? failure("Screen request cancelled", 499)); continue; }
      const own = state.slots.find(slot => slot.target?.botId === request.botId);
      if (own?.pending) continue;
      if (own?.ready) { finish(state, request, undefined, lease(state, own, request)); continue; }
      const available = own ?? state.slots.find(slot => !slot.target && !slot.pending) ?? state.slots
        .filter(slot => !slot.pending && ![...slot.leases.values()].some(kind => kind !== "watch"))
        .sort((left, right) => left.usedAt - right.usedAt)[0];
      if (available) prepare(state, available, request.botId);
    }
  }
  async function closeContainer(container: ScreenContainer): Promise<void> {
    const identity = key(container);
    const state = containers.get(identity);
    if (!state) return;
    if (state.closing) return state.closing;
    state.closed = true;
    state.abort.abort();
    const closing = Promise.resolve().then(async () => {
      for (const request of state.queue.slice()) finish(state, request, failure("Shared computer closed", 503));
      for (const slot of state.slots) {
        slot.ready = false;
        slot.leases.clear();
        if (slot.target) hooks.revoke(state.container, slot.target);
      }
      await Promise.allSettled([state.initialization, ...state.slots.map(slot => slot.pending)]);
      const targets = state.slots.flatMap(slot => [slot.cleanup, slot.target].filter((target): target is IndependentScreenTarget => Boolean(target)));
      const unique = [...new Map(targets.map(target => [`${target.display}:${target.generation}`, target])).values()];
      await Promise.all(unique.map(target => hooks.stop(state.container, target)));
    }).finally(() => { if (containers.get(identity) === state) containers.delete(identity); });
    state.closing = closing;
    return closing;
  }
  return {
    acquire(container: ScreenContainer, botId: string, options: { kind: ScreenLeaseKind; signal?: AbortSignal }): Promise<IndependentScreenLease> {
      if (closed) return Promise.reject(failure("Shared screen broker closed", 503));
      if (!ID.test(botId) || !["turn", "hold", "watch"].includes(options.kind)) return Promise.reject(failure("Invalid screen lease", 400));
      let identity: string;
      try { identity = key(container); }
      catch (error) { return Promise.reject(error); }
      if ([...containers.values()].some(state => state.container.sshAlias === container.sshAlias && state.container.containerId === container.containerId && state.container.ownerId !== container.ownerId)) {
        return Promise.reject(failure("This container belongs to a different computer owner", 403));
      }
      let state = containers.get(identity);
      if (!state) {
        state = { container: Object.freeze({ ...container }), slots: INDEPENDENT_DISPLAYS.map(display => ({ display, ready: false, leases: new Map(), usedAt: 0 })),
          queue: [], abort: new AbortController(), initialized: false, closed: false };
        containers.set(identity, state);
      }
      const kept = state;
      if (kept.closed) return Promise.reject(failure("Shared screen broker closed", 503));
      if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? failure("Screen request cancelled", 499));
      if (kept.queue.length >= QUEUE_LIMIT) return Promise.reject(failure("Too many pending screen requests", 429));
      return new Promise((resolve, reject) => {
        const request: Request = { botId, kind: options.kind, signal: options.signal, resolve, reject };
        request.abort = () => { finish(kept, request, options.signal?.reason ?? failure("Screen request cancelled", 499)); drain(kept); };
        kept.queue.push(request);
        options.signal?.addEventListener("abort", request.abort, { once: true });
        drain(kept);
      });
    },
    busy(container: ScreenContainer): boolean {
      const state = containers.get(key(container));
      if (!state) return false;
      if (state.closing) return true;
      if (state.closed) return false;
      return Boolean(state.initialization || state.slots.some(slot => slot.pending || [...slot.leases.values()].some(kind => kind !== "watch")) || state.queue.some(request => request.kind !== "watch"));
    },
    closeContainer,
    async close() {
      closed = true;
      await Promise.all([...containers.values()].map(state => closeContainer(state.container)));
    },
  };
}
