import type { StateBackend, StateHandle } from "./backend.ts";
import { STORE_LAYOUTS } from "./layouts.ts";
import type { StoreLayout } from "./layouts.ts";

type Doc = Record<string, unknown>;
/** what a backend holds when it starts: each store's root document and every collection's rows (with `_id` and `_n`) */
export interface LoadedData { roots: Map<string, Doc>; rows: Map<string, Doc[]> }
/** one durable write: all of it lands or none of it does */
export interface WriteBatch {
  collections: Map<string, { upserts: Array<{ _id: string; doc: Doc }>; deletes: string[] }>;
  roots: Array<{ _id: string; doc: Doc }>;
  appends: Array<{ log: string; entry: Doc }>;
}
export interface BatchWriter { write(batch: WriteBatch): Promise<void> }

interface OpenStore {
  name: string; state: Doc; layout: StoreLayout;
  rootJson: string;
  rowJson: Map<string, Map<string, string>>;
  /** the next write diffs every row (anything may have changed), or only the rows named with changedRow */
  full: boolean; hinted: Map<string, Set<Doc>>; fullAt: number;
}

const RETRY_MS = [500, 1000, 2000, 5000, 10_000, 30_000];
const CHANGED_DELAY_MS = 100;
/** a store written only row by row is still diffed whole this often, so a change nobody named is never kept back long */
const FULL_EVERY_MS = 60_000;

/**
 * Keeps each store's rows as documents and writes only what changed since the last successful write. The diff runs
 * against what was last written, so a failed write is simply retried with everything changed since.
 * `next` hands out insertion numbers, so rows load back in the order they were first written.
 */
export function createDiffBackend(options: { loaded: LoadedData; writer: BatchWriter; layouts?: Record<string, StoreLayout>; log?: (line: string) => void; nextOrder?: number }): StateBackend & { flush(timeoutMs?: number): Promise<void> } {
  const layouts = options.layouts ?? STORE_LAYOUTS, log = options.log ?? (line => console.error(`persistence: ${line}`));
  const stores = new Map<string, OpenStore>();
  const dirty = new Set<OpenStore>();
  let appends: WriteBatch["appends"] = [];
  let order = options.nextOrder ?? Math.max(0, ...[...options.loaded.rows.values()].flat().map(row => Number(row._n) || 0)) + 1;
  const orderOf = new Map<string, number>();
  for (const [collection, rows] of options.loaded.rows) for (const row of rows) orderOf.set(`${collection}\u0000${row._id}`, Number(row._n) || 0);
  let timer: ReturnType<typeof setTimeout> | null = null, timerAt = Infinity;
  let running: Promise<void> | null = null;
  // a snapshot stringifies every row of the stores it writes (about 190 ms for 2000 busy workspaces on the contabo box):
  // the next one waits twice as long as the last took, so writing never holds more than a third of the event loop
  let snapshotMs = 0, snapshotAt = 0;
  let failures = 0, lastError: string | null = null;
  let waiters: Array<() => void> = [];

  const idle = () => !dirty.size && !appends.length && !running;
  function wake() { if (idle()) { const done = waiters; waiters = []; for (const resolve of done) resolve(); } }
  function schedule(delay: number) {
    const at = Math.max(Date.now() + delay, snapshotAt + 3 * snapshotMs);
    if (timer && timerAt <= at) return;
    if (timer) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(() => { timer = null; timerAt = Infinity; void run(); }, Math.max(0, at - Date.now()));
    timer.unref?.();
  }

  /** what to write for a store: every row diffed, or with `hinted` only the rows named (a busy store of large rows,
   *  2000 workspaces' reports, cost a whole stringify of every row per report otherwise) */
  function snapshot(store: OpenStore, hinted: Map<string, Set<Doc>> | null) {
    const ops: Array<{ collection: string; upserts: Array<{ _id: string; doc: Doc; json: string }>; deletes: string[]; seen: Map<string, string> }> = [];
    if (hinted) {
      for (const [field, touched] of hinted) {
        const spec = store.layout[field]!, previous = store.rowJson.get(spec.collection)!, seen = new Map(previous);
        const present = new Set((store.state[field] ?? []) as Doc[]), upserts: Array<{ _id: string; doc: Doc; json: string }> = [];
        for (const row of touched) {
          const id = spec.key(row);
          // a row removed since it was named goes with the next whole diff, which sees it gone
          if (!present.has(row) || typeof id !== "string" || !id) continue;
          const json = JSON.stringify(row);
          seen.set(id, json);
          if (previous.get(id) === json) continue;
          const slot = `${spec.collection}\u0000${id}`;
          if (!orderOf.has(slot)) orderOf.set(slot, order++);
          upserts.push({ _id: id, doc: { ...JSON.parse(json) as Doc, _n: orderOf.get(slot) }, json });
        }
        ops.push({ collection: spec.collection, upserts, deletes: [], seen });
      }
      return { ops, rootJson: store.rootJson, rootChanged: false };
    }
    for (const [field, spec] of Object.entries(store.layout)) {
      const rows = (store.state[field] ?? []) as Doc[];
      const seen = new Map<string, string>(), previous = store.rowJson.get(spec.collection)!;
      const upserts: Array<{ _id: string; doc: Doc; json: string }> = [];
      for (const row of rows) {
        const id = spec.key(row);
        if (typeof id !== "string" || !id) { log(`${store.name}.${field}: a row without a key was not written`); continue; }
        if (seen.has(id)) { log(`${store.name}.${field}: two rows share one key; the later one was written`); }
        const json = JSON.stringify(row);
        seen.set(id, json);
        if (previous.get(id) !== json) {
          const slot = `${spec.collection}\u0000${id}`;
          if (!orderOf.has(slot)) orderOf.set(slot, order++);
          upserts.push({ _id: id, doc: { ...JSON.parse(json) as Doc, _n: orderOf.get(slot) }, json });
        }
      }
      const deletes = [...previous.keys()].filter(id => !seen.has(id));
      ops.push({ collection: spec.collection, upserts: upserts.filter((item, index) => upserts.findLastIndex(other => other._id === item._id) === index), deletes, seen });
    }
    const root: Doc = {};
    for (const [field, value] of Object.entries(store.state)) if (!(field in store.layout)) root[field] = value;
    const rootJson = JSON.stringify(root);
    return { ops, rootJson, rootChanged: rootJson !== store.rootJson };
  }

  async function run(): Promise<void> {
    if (running) return;
    if (!dirty.size && !appends.length) { wake(); return; }
    const batchStores = [...dirty]; dirty.clear();
    const batchAppends = appends; appends = [];
    snapshotAt = Date.now();
    const started = performance.now();
    const taken = batchStores.map(store => {
      const hinted = !store.full && Date.now() - store.fullAt < FULL_EVERY_MS ? store.hinted : null;
      store.full = false; store.hinted = new Map();
      if (!hinted) store.fullAt = Date.now();
      return { store, ...snapshot(store, hinted) };
    });
    snapshotMs = performance.now() - started;
    const batch: WriteBatch = { collections: new Map(), roots: [], appends: batchAppends };
    for (const { store, ops, rootJson, rootChanged } of taken) {
      for (const op of ops) if (op.upserts.length || op.deletes.length) batch.collections.set(op.collection, { upserts: op.upserts.map(({ _id, doc }) => ({ _id, doc })), deletes: op.deletes });
      if (rootChanged) batch.roots.push({ _id: store.name, doc: JSON.parse(rootJson) as Doc });
    }
    if (!batch.collections.size && !batch.roots.length && !batch.appends.length) { wake(); return; }
    running = options.writer.write(batch);
    try {
      await running;
      for (const { store, ops, rootJson } of taken) {
        for (const op of ops) store.rowJson.set(op.collection, op.seen);
        store.rootJson = rootJson;
      }
      failures = 0; lastError = null;
    } catch (error) {
      for (const { store } of taken) { dirty.add(store); store.full = true; }
      appends = [...batchAppends, ...appends];
      lastError = error instanceof Error ? error.name : "error";
      log(`write failed (${lastError}: ${error instanceof Error ? error.message.slice(0, 200) : ""}), retrying`);
      schedule(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]!);
    } finally {
      running = null;
    }
    if (dirty.size || appends.length) { if (!timer) schedule(0); } else wake();
  }

  return {
    open<T extends object>(name: string, initial: () => T, valid: (value: unknown) => value is T): StateHandle<T> {
      if (stores.has(name)) throw new Error(`The ${name} store is already open.`);
      const layout = layouts[name] ?? {};
      const root = options.loaded.roots.get(name);
      const rowsOf = (collection: string) => (options.loaded.rows.get(collection) ?? []).slice().sort((a, b) => (Number(a._n) || 0) - (Number(b._n) || 0))
        .map(({ _id, _n, ...row }) => row);
      const hasRows = Object.values(layout).some(spec => (options.loaded.rows.get(spec.collection) ?? []).length > 0);
      let state: Doc = initial() as Doc;
      if (root || hasRows) {
        const { _id, ...rest } = root ?? {};
        const assembled: Doc = root ? rest : { ...state };
        for (const [field, spec] of Object.entries(layout)) assembled[field] = rowsOf(spec.collection);
        if (!valid(assembled)) throw new Error(`Invalid state in the ${name} store.`);
        state = assembled;
      }
      const rowJson = new Map<string, Map<string, string>>();
      for (const [field, spec] of Object.entries(layout)) {
        const rows = (root || hasRows) ? (state[field] as Doc[]) : [];
        rowJson.set(spec.collection, new Map(rows.map(row => [spec.key(row), JSON.stringify(row)])));
      }
      const rootDoc: Doc = {};
      if (root) for (const [field, value] of Object.entries(state)) if (!(field in layout)) rootDoc[field] = value;
      const store: OpenStore = { name, state, layout, rowJson, rootJson: root ? JSON.stringify(rootDoc) : "", full: true, hinted: new Map(), fullAt: 0 };
      stores.set(name, store);
      return {
        state: state as T,
        commit() { dirty.add(store); store.full = true; schedule(0); },
        changed() { dirty.add(store); store.full = true; schedule(CHANGED_DELAY_MS); },
        changedRow(field, row) {
          if (!(field in store.layout)) store.full = true;
          else if (!store.full) { const set = store.hinted.get(field) ?? new Set<Doc>(); set.add(row as Doc); store.hinted.set(field, set); }
          dirty.add(store); schedule(CHANGED_DELAY_MS);
        },
        close() { dirty.add(store); store.full = true; schedule(0); },
      };
    },
    append(log, entry) { appends.push({ log, entry: JSON.parse(JSON.stringify(entry)) as Doc }); schedule(0); },
    settled(timeoutMs = 10_000) {
      if (idle() && !timer) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { waiters = waiters.filter(item => item !== done); reject(new Error("State not written in time.")); }, timeoutMs);
        timeout.unref?.();
        const done = () => { clearTimeout(timeout); resolve(); };
        waiters.push(done);
        schedule(0);
      });
    },
    written(name, field, key) {
      const store = stores.get(name), spec = store?.layout[field];
      const json = spec ? store!.rowJson.get(spec.collection)?.get(key) : undefined;
      return json === undefined ? null : JSON.parse(json);
    },
    health: () => ({ ok: failures === 0, detail: lastError ? `last write failed: ${lastError}` : "ok" }),
    flush(timeoutMs = 30_000) { return this.settled(timeoutMs); },
  };
}
