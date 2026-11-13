import { describe, expect, it } from "vitest";
import { createDiffBackend } from "./diff-backend.ts";
import type { LoadedData, WriteBatch } from "./diff-backend.ts";

type Doc = Record<string, unknown>;
const layouts = { shop: { items: { collection: "items", key: (row: Doc) => row.id as string } } };

/** an in-memory database the backend writes to; `fail` makes the next writes throw */
function memory(initial?: { roots?: Array<[string, Doc]>; items?: Doc[] }) {
  const db = { roots: new Map<string, Doc>(initial?.roots ?? []), items: new Map<string, Doc>((initial?.items ?? []).map(doc => [doc._id as string, doc])), logs: [] as Doc[] };
  const batches: WriteBatch[] = [];
  let fail = 0;
  const writer = { async write(batch: WriteBatch) {
    if (fail > 0) { fail--; throw new Error("down"); }
    batches.push(batch);
    for (const [, ops] of batch.collections) { for (const id of ops.deletes) db.items.delete(id); for (const { _id, doc } of ops.upserts) db.items.set(_id, { _id, ...doc }); }
    for (const { _id, doc } of batch.roots) db.roots.set(_id, { _id, ...doc });
    for (const { entry } of batch.appends) db.logs.push(entry);
  } };
  const loaded = (): LoadedData => ({ roots: new Map(db.roots), rows: new Map([["items", [...db.items.values()]]]) });
  return { db, batches, writer, loaded, failNext: (n: number) => { fail = n; } };
}
const valid = (value: unknown): value is { v: number; items: Doc[]; queue: number[] } => !!value && Array.isArray((value as { items?: unknown }).items);
const initial = () => ({ v: 1, items: [] as Doc[], queue: [] as number[] });

describe("diff backend", () => {
  it("writes only changed rows, deletes removed ones, and loads them back in insertion order", async () => {
    const m = memory();
    const backend = createDiffBackend({ loaded: m.loaded(), writer: m.writer, layouts, log: () => {} });
    const store = backend.open("shop", initial, valid);
    store.state.items.push({ id: "b", n: 1 }, { id: "a", n: 2 });
    store.state.queue.push(7);
    store.commit();
    await backend.settled();
    expect([...m.db.items.keys()].sort()).toEqual(["a", "b"]);
    expect(m.db.roots.get("shop")).toMatchObject({ v: 1, queue: [7] });

    store.state.items[0]!.n = 5;
    store.state.items = store.state.items.filter(row => row.id !== "a");
    store.changed();
    await backend.settled();
    const last = m.batches.at(-1)!.collections.get("items")!;
    expect(last.upserts.map(row => row._id)).toEqual(["b"]);
    expect(last.deletes).toEqual(["a"]);
    expect(m.batches.at(-1)!.roots).toEqual([]);

    store.state.items.push({ id: "c", n: 3 });
    store.commit();
    await backend.settled();
    const again = createDiffBackend({ loaded: m.loaded(), writer: m.writer, layouts, log: () => {} }).open("shop", initial, valid);
    expect(again.state).toEqual({ v: 1, queue: [7], items: [{ id: "b", n: 5 }, { id: "c", n: 3 }] });
  });

  it("diffs only a row named with changedRow, and whole again after any other change or a failed write", async () => {
    const m = memory();
    const backend = createDiffBackend({ loaded: m.loaded(), writer: m.writer, layouts, log: () => {} });
    const store = backend.open("shop", initial, valid);
    store.state.items.push({ id: "a", n: 1 }, { id: "b", n: 1 });
    store.commit();
    await backend.settled();
    const a = store.state.items[0]!, b = store.state.items[1]!;
    const strings = JSON.stringify;
    let stringified = 0;
    JSON.stringify = ((...args: Parameters<typeof strings>) => { stringified++; return strings(...args); }) as typeof JSON.stringify;
    try {
      a.n = 2;
      store.changedRow("items", a);
      await backend.settled();
      expect(stringified).toBe(1);
    } finally { JSON.stringify = strings; }
    expect(m.db.items.get("a")).toMatchObject({ n: 2 });

    // a change nobody named waits for the next whole diff, which changed() asks for
    b.n = 2;
    a.n = 3;
    store.changedRow("items", a);
    await backend.settled();
    expect(m.db.items.get("b")).toMatchObject({ n: 1 });
    store.changed();
    await backend.settled();
    expect(m.db.items.get("b")).toMatchObject({ n: 2 });

    // a named row removed before the write is not brought back; a failed write is retried whole
    store.state.items = store.state.items.filter(row => row.id !== "a");
    store.changedRow("items", a);
    store.changed();
    m.failNext(1);
    await backend.settled();
    expect(m.db.items.has("a")).toBe(false);
    b.n = 4;
    m.failNext(1);
    store.changedRow("items", b);
    await backend.settled();
    expect(m.db.items.get("b")).toMatchObject({ n: 4 });
  });

  it("retries a failed write with everything changed since, and settles only once it lands", async () => {
    const m = memory();
    const backend = createDiffBackend({ loaded: m.loaded(), writer: m.writer, layouts, log: () => {} });
    const store = backend.open("shop", initial, valid);
    m.failNext(1);
    store.state.items.push({ id: "x" });
    store.commit();
    const settled = backend.settled(5000);
    store.state.items.push({ id: "y" });
    store.changed();
    expect(backend.health().ok).toBe(true);
    await settled;
    expect([...m.db.items.keys()].sort()).toEqual(["x", "y"]);
    expect(backend.health().ok).toBe(true);
  });

  it("rejects settled() when writes keep failing, and reports it in health", async () => {
    const m = memory();
    const backend = createDiffBackend({ loaded: m.loaded(), writer: m.writer, layouts, log: () => {} });
    const store = backend.open("shop", initial, valid);
    m.failNext(100);
    store.state.items.push({ id: "x" });
    store.commit();
    await expect(backend.settled(300)).rejects.toThrow();
    expect(backend.health().ok).toBe(false);
  });

  it("refuses to open state that fails validation, and one store twice", () => {
    const m = memory({ roots: [["shop", { _id: "shop", v: 1, items: "nope" }]] });
    const backend = createDiffBackend({ loaded: { roots: m.loaded().roots, rows: new Map() }, writer: m.writer, layouts: {}, log: () => {} });
    expect(() => backend.open("shop", initial, valid)).toThrow(/Invalid state/);
    const fresh = createDiffBackend({ loaded: memory().loaded(), writer: m.writer, layouts, log: () => {} });
    fresh.open("shop", initial, valid);
    expect(() => fresh.open("shop", initial, valid)).toThrow(/already open/);
  });

  it("writes appended log lines with the next flush", async () => {
    const m = memory();
    const backend = createDiffBackend({ loaded: m.loaded(), writer: m.writer, layouts, log: () => {} });
    backend.append("audit", { at: 1, action: "x" });
    await backend.settled();
    expect(m.db.logs).toEqual([{ at: 1, action: "x" }]);
  });
});

describe("written", () => {
  it("answers a row as last written, not as changed in memory since", async () => {
    const m = memory();
    const backend = createDiffBackend({ loaded: m.loaded(), writer: m.writer, layouts, log: () => {} });
    const store = backend.open("shop", initial, valid);
    store.state.items.push({ id: "a", hold: false });
    expect(backend.written("shop", "items", "a")).toBeNull();
    store.commit(); await backend.settled();
    store.state.items[0]!.hold = true;
    expect(backend.written("shop", "items", "a")).toEqual({ id: "a", hold: false });
    store.commit(); await backend.settled();
    expect(backend.written("shop", "items", "a")).toEqual({ id: "a", hold: true });
    expect(backend.written("shop", "nothing", "a")).toBeNull();
  });
});
