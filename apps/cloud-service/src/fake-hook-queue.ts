// A Durable Object namespace for the edge's HookQueue as tests and the fake e2e need it: one object per name, its storage
// kept apart from the instance (so a new instance on the same storage is an isolate that ended), and its alarm run by hand.
import { HookQueue, type HookQueueStorage } from "../edge/hook-queue.js";
import type { EdgeEnv, HookQueueNamespace } from "../edge/worker.js";

export interface FakeStorage extends HookQueueStorage { data: Map<string, unknown>; alarm: number | null }

function fakeStorage(): FakeStorage {
  const data = new Map<string, unknown>();
  // values are copied in and out, as a real store keeps no reference to the caller's objects
  const copy = <T>(value: T): T => structuredClone(value);
  const storage = {
    data, alarm: null as number | null,
    async get(key: string | string[]) {
      if (Array.isArray(key)) return new Map(key.filter(k => data.has(k)).map(k => [k, copy(data.get(k))]));
      return copy(data.get(key));
    },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      for (const [k, v] of typeof key === "string" ? [[key, value] as const] : Object.entries(key)) data.set(k, copy(v));
    },
    async delete(key: string | string[]) { for (const k of Array.isArray(key) ? key : [key]) data.delete(k); },
    async list(options: { prefix?: string } = {}) {
      return new Map([...data.keys()].filter(k => k.startsWith(options.prefix ?? "")).sort().map(k => [k, copy(data.get(k))]));
    },
    async getAlarm() { return storage.alarm; },
    async setAlarm(at: number) { storage.alarm = at; },
  };
  return storage as unknown as FakeStorage;
}

export function fakeHookQueues(env: () => EdgeEnv, now: () => number = () => Date.now()) {
  const objects = new Map<string, { storage: FakeStorage; instance: HookQueue }>();
  const open = (name: string) => {
    let object = objects.get(name);
    if (!object) {
      const storage = fakeStorage(), instance = new HookQueue({ storage }, env());
      instance.now = now;
      objects.set(name, object = { storage, instance });
    }
    return object;
  };
  const namespace: HookQueueNamespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({ fetch: (input: string, init?: RequestInit) => open(String(id)).instance.fetch(new Request(input, init)) }),
  };
  return {
    namespace,
    storage: (name: string) => open(name).storage,
    /** the isolate ends: a fresh instance on the same storage */
    restart(name: string) { const object = open(name); object.instance = new HookQueue({ storage: object.storage }, env()); object.instance.now = now; return object.instance; },
    /** runs the alarm if one is due (or at all, with force), as the runtime would */
    async runAlarm(name: string, force = false) {
      const object = open(name), at = object.storage.alarm;
      if (at === null || (!force && at > now())) return false;
      object.storage.alarm = null;
      await object.instance.alarm();
      return true;
    },
  };
}
