import type { EdgeEnv } from "./worker.js";

export interface HookQueueStorage {
  get(key: string): Promise<unknown>;
  get(keys: string[]): Promise<Map<string, unknown>>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string | string[]): Promise<unknown>;
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
export declare const QUEUE_LIMITS: { maxEntries: number; maxBytes: number; maxEnvelope: number; chunk: number; firstRetryMs: number; maxRetryMs: number; dropAfterMs: number; seenMs: number };
export declare function queueReady(env: Partial<EdgeEnv>): boolean;
export declare function envelope(hook: { method: string; path: string; headers: HeadersInit; body?: ArrayBuffer | Uint8Array }): Uint8Array;
export declare function openEnvelope(bytes: Uint8Array): { method: string; path: string; headers: Array<[string, string]>; body: Uint8Array | undefined };
export declare class HookQueue {
  constructor(state: { storage: HookQueueStorage }, env: EdgeEnv);
  storage: HookQueueStorage;
  now: () => number;
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}
