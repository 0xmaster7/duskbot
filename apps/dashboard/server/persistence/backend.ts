// Where the account service's state lives. Every module keeps its state in memory and says when it changed; a backend
// makes that durable. Without one (tests, local fixtures) each store is a JSON file in the data folder; production sets
// the MongoDB backend once at start (main.ts), before any store opens.
export interface StateHandle<T extends object> {
  state: T;
  /** write at once: money, webhooks, provisioning steps */
  commit(): void;
  /** write soon; several changes share one write */
  changed(): void;
  /** write what is pending now */
  close(): void;
}

export interface StateBackend {
  open<T extends object>(name: string, initial: () => T, valid: (value: unknown) => value is T): StateHandle<T>;
  /** one append-only log line (the managed cloud's audit), written with the next flush */
  append(log: string, entry: object): void;
  /** resolves once everything changed so far is durable; rejects when that does not happen within `timeoutMs` */
  settled(timeoutMs?: number): Promise<void>;
  health(): { ok: boolean; detail: string };
}

let current: StateBackend | null = null;

export function useStateBackend(backend: StateBackend | null) { current = backend; }
export function stateBackend(): StateBackend | null { return current; }
/** what a response waits for before the client hears it: nothing without a backend */
export function persisted(timeoutMs?: number): Promise<void> { return current ? current.settled(timeoutMs) : Promise.resolve(); }
