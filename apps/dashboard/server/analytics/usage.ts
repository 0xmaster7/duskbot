// What people use Dusk for: the usage section of workspace reports (shared/usage-signals.ts), kept raw for
// USAGE_RETENTION_DAYS and rolled up per day into counts that are kept. Records hold words, counts and times, plus the
// scrubbed summaries a workspace wrote; never message content.
import type { Db } from "mongodb";
import { USAGE_REASONS, type UsageDigest, type UsageFrustration, type UsageReport, type UsageRun, type UsageSnapshot, type UsageTurn } from "../../../../shared/usage-signals.ts";
import { DAY_MS, dayOf } from "./events.ts";

export const USAGE_RETENTION_DAYS = 90;
/** per person per day counts feed the power-user and active-day views; kept longer than raw records, not forever */
export const PEOPLE_RETENTION_DAYS = 400;
/** turn time buckets in seconds; a percentile reads as its bucket's upper edge */
export const LATENCY_EDGES = [2, 5, 10, 20, 30, 60, 120, 300, 600, Infinity] as const;
export const latencyBucket = (ms: number) => LATENCY_EDGES.findIndex(edge => ms / 1000 <= edge);

type Kind = "turn" | "run" | "frustration" | "digest";
export interface UsageRecord { id: string; kind: Kind; at: number; accountId: string; workspaceId: string; data: UsageTurn | UsageRun | UsageFrustration | UsageDigest }
/** `appTurns`: turns that used a connected app, so the adoption view can count people who use one */
export interface PersonDay { day: string; accountId: string; turns: number; failed: number; runs: number; frustrations: number; appTurns: number }
export interface SnapshotRow { workspaceId: string; accountId: string; at: number; snapshot: UsageSnapshot }

export interface UsageStore {
  /** the records not seen before; a record sent twice is kept once */
  insert(records: UsageRecord[]): Promise<UsageRecord[]>;
  bump(day: string, inc: Record<string, number>): Promise<void>;
  /** adds to a person's day; true when it is the person's first record that day */
  person(day: string, accountId: string, inc: Partial<Omit<PersonDay, "day" | "accountId">>): Promise<boolean>;
  snapshot(row: SnapshotRow): Promise<void>;
  daily(fromDay: string, toDay: string): Promise<Array<{ day: string; c: Record<string, number> }>>;
  people(fromDay: string, toDay: string): Promise<PersonDay[]>;
  snapshots(): Promise<SnapshotRow[]>;
  records(kind: Kind, since: number, until: number, limit: number): Promise<UsageRecord[]>;
  /** true the first time a key is seen; kept forever */
  once(key: string): Promise<boolean>;
  forget(accountId: string): Promise<void>;
  forgetWorkspace(workspaceId: string): Promise<void>;
}

export function memoryUsageStore(now: () => number = Date.now): UsageStore {
  const records = new Map<string, UsageRecord>(), daily = new Map<string, Record<string, number>>(), people = new Map<string, PersonDay>(), snaps = new Map<string, SnapshotRow>(), marks = new Set<string>();
  const sweep = () => { const cutoff = now() - USAGE_RETENTION_DAYS * DAY_MS; for (const [id, record] of records) if (record.at < cutoff) records.delete(id); };
  return {
    async insert(list) {
      sweep();
      const fresh: UsageRecord[] = [];
      for (const record of list) { const key = `${record.workspaceId}:${record.id}`; if (!records.has(key)) { records.set(key, record); fresh.push(record); } }
      return fresh;
    },
    async bump(day, inc) { const row = daily.get(day) ?? {}; for (const [key, by] of Object.entries(inc)) row[key] = (row[key] ?? 0) + by; daily.set(day, row); },
    async person(day, accountId, inc) {
      const key = `${day}|${accountId}`, row = people.get(key), first = !row;
      const next = row ?? { day, accountId, turns: 0, failed: 0, runs: 0, frustrations: 0, appTurns: 0 };
      for (const [field, by] of Object.entries(inc)) (next as unknown as Record<string, number>)[field]! += by ?? 0;
      people.set(key, next);
      return first;
    },
    async snapshot(row) { snaps.set(row.workspaceId, row); },
    async daily(fromDay, toDay) { return [...daily].filter(([day]) => day >= fromDay && day <= toDay).map(([day, c]) => ({ day, c: { ...c } })); },
    async people(fromDay, toDay) { return [...people.values()].filter(row => row.day >= fromDay && row.day <= toDay); },
    async snapshots() { return [...snaps.values()]; },
    async records(kind, since, until, limit) { return [...records.values()].filter(r => r.kind === kind && r.at >= since && r.at < until).sort((a, b) => b.at - a.at).slice(0, limit); },
    async once(key) { if (marks.has(key)) return false; marks.add(key); return true; },
    async forget(accountId) {
      for (const [key, record] of records) if (record.accountId === accountId) records.delete(key);
      for (const [key, row] of people) if (row.accountId === accountId) people.delete(key);
      for (const [key, row] of snaps) if (row.accountId === accountId) snaps.delete(key);
    },
    async forgetWorkspace(workspaceId) {
      for (const [key, record] of records) if (record.workspaceId === workspaceId) records.delete(key);
      snaps.delete(workspaceId);
    },
  };
}

type RecordDoc = { _id: string; kind: Kind; at: Date; accountId: string; workspaceId: string; data: UsageRecord["data"] };
/** usage_events (TTL on `at`), usage_daily (kept), usage_people (TTL on `at`), usage_snapshots (one per workspace) */
export async function mongoUsageStore(db: Db): Promise<UsageStore> {
  const events = db.collection<RecordDoc>("usage_events"), daily = db.collection<{ _id: string; day: string; c: Record<string, number> }>("usage_daily");
  const people = db.collection<{ _id: string; day: string; accountId: string; at: Date; turns: number; failed: number; runs: number; frustrations: number; appTurns: number }>("usage_people");
  const snaps = db.collection<{ _id: string; accountId: string; at: Date; snapshot: UsageSnapshot }>("usage_snapshots"), marks = db.collection<{ _id: string }>("usage_marks");
  await Promise.all([
    events.createIndexes([{ key: { at: 1 }, expireAfterSeconds: USAGE_RETENTION_DAYS * 86_400 }, { key: { kind: 1, at: -1 } }, { key: { accountId: 1 } }, { key: { workspaceId: 1 } }]),
    people.createIndexes([{ key: { at: 1 }, expireAfterSeconds: PEOPLE_RETENTION_DAYS * 86_400 }, { key: { day: 1 } }, { key: { accountId: 1 } }]),
    snaps.createIndexes([{ key: { accountId: 1 } }]),
  ]);
  const toRecord = (doc: RecordDoc): UsageRecord => ({ id: doc._id.slice(doc.workspaceId.length + 1), kind: doc.kind, at: doc.at.getTime(), accountId: doc.accountId, workspaceId: doc.workspaceId, data: doc.data });
  return {
    async insert(list) {
      if (!list.length) return [];
      const docs = list.map(record => ({ _id: `${record.workspaceId}:${record.id}`, kind: record.kind, at: new Date(record.at), accountId: record.accountId, workspaceId: record.workspaceId, data: record.data }));
      const failed = new Set<number>();
      try { await events.insertMany(docs, { ordered: false }); } catch (error) {
        const errors = (error as { writeErrors?: Array<{ index: number; code: number }> | { index: number; code: number } }).writeErrors;
        const list_ = Array.isArray(errors) ? errors : errors ? [errors] : null;
        if (!list_ || list_.some(item => item.code !== 11000)) throw error;
        for (const item of list_) failed.add(item.index);
      }
      return list.filter((_, index) => !failed.has(index));
    },
    async bump(day, inc) { await daily.updateOne({ _id: day }, { $setOnInsert: { day }, $inc: Object.fromEntries(Object.entries(inc).map(([key, by]) => [`c.${key}`, by])) }, { upsert: true }); },
    async person(day, accountId, inc) {
      const result = await people.updateOne({ _id: `${day}|${accountId}` }, { $setOnInsert: { day, accountId, at: new Date(`${day}T12:00:00Z`) }, $inc: { turns: 0, failed: 0, runs: 0, frustrations: 0, appTurns: 0, ...inc } }, { upsert: true });
      return result.upsertedCount === 1;
    },
    async snapshot(row) { await snaps.replaceOne({ _id: row.workspaceId }, { accountId: row.accountId, at: new Date(row.at), snapshot: row.snapshot }, { upsert: true }); },
    async daily(fromDay, toDay) { return (await daily.find({ _id: { $gte: fromDay, $lte: toDay } }).toArray()).map(doc => ({ day: doc.day, c: doc.c ?? {} })); },
    async people(fromDay, toDay) {
      return (await people.find({ day: { $gte: fromDay, $lte: toDay } }, { projection: { _id: 0, at: 0 } }).toArray()) as unknown as PersonDay[];
    },
    async snapshots() { return (await snaps.find({}).toArray()).map(doc => ({ workspaceId: doc._id, accountId: doc.accountId, at: doc.at.getTime(), snapshot: doc.snapshot })); },
    async records(kind, since, until, limit) { return (await events.find({ kind, at: { $gte: new Date(since), $lt: new Date(until) } }).sort({ at: -1 }).limit(limit).toArray()).map(toRecord); },
    async once(key) { try { await marks.insertOne({ _id: key }); return true; } catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; } },
    async forget(accountId) { await Promise.all([events.deleteMany({ accountId }), people.deleteMany({ accountId }), snaps.deleteMany({ accountId })]); },
    async forgetWorkspace(workspaceId) { await Promise.all([events.deleteMany({ workspaceId }), snaps.deleteOne({ _id: workspaceId })]); },
  };
}

/** a frustration's problem group: engine, category and the first app or tool it touched */
export const problemKey = (f: Pick<UsageFrustration, "engine" | "category" | "apps" | "tools">) => `${f.engine}|${f.category}|${f.apps[0] ?? f.tools.find(tool => tool !== "memory" && tool !== "other") ?? "none"}`;

/** the day's counters a set of fresh records adds, keyed flat so they sum across days */
export function rollup(records: UsageRecord[]): Map<string, Record<string, number>> {
  const days = new Map<string, Record<string, number>>();
  const add = (day: string, key: string, by = 1) => { const row = days.get(day) ?? {}; row[key] = (row[key] ?? 0) + by; days.set(day, row); };
  for (const record of records) {
    const day = dayOf(record.at);
    if (record.kind === "turn") {
      const t = record.data as UsageTurn, failed = t.outcome === "failed", bucket = latencyBucket(t.ms);
      add(day, "turns"); add(day, t.outcome); add(day, `lat:${bucket}`); add(day, `ms`, t.ms);
      add(day, `engine:${t.engine}`); add(day, `lat_engine:${t.engine}:${bucket}`); add(day, `category:${t.category}`); add(day, `from:${t.from}`); add(day, `place:${t.place}`);
      if (t.room) add(day, "room");
      for (const tool of t.tools) add(day, `tool:${tool}`);
      for (const app of t.apps) add(day, `app:${app}`);
      if (failed) {
        const reason = t.reason ?? "unknown";
        add(day, `engine_fail:${t.engine}`); add(day, `category_fail:${t.category}`); add(day, `reason:${reason}`); add(day, `reason_engine:${t.engine}:${reason}`);
        for (const tool of t.tools) { add(day, `tool_fail:${tool}`); add(day, `reason_tool:${tool}:${reason}`); }
        for (const app of t.apps) { add(day, `app_fail:${app}`); add(day, `reason_app:${app}:${reason}`); }
      }
      if (t.outcome === "cancelled") add(day, `engine_cancel:${t.engine}`);
    } else if (record.kind === "run") {
      const r = record.data as UsageRun;
      add(day, "runs"); add(day, `run:${r.trigger}`);
      if (r.outcome === "failed") { add(day, "run_failed"); add(day, `run_fail:${r.trigger}`); add(day, `run_reason:${r.reason ?? "unknown"}`); }
    } else if (record.kind === "frustration") {
      const f = record.data as UsageFrustration;
      add(day, "frustrations"); add(day, `fr_group:${problemKey(f)}`);
      for (const signal of f.signals) add(day, `fr_signal:${signal}`);
    } else add(day, "digests");
  }
  return days;
}

export function createUsage(options: {
  store: UsageStore; now?: () => number;
  /** the account turned analytics off, or turned summaries off */
  optedOut(accountId: string): boolean; summariesOff(accountId: string): boolean;
  /** a frustration group seen for the first time ever */
  newProblem?(group: { key: string; example: string | null; count: number }): void;
}) {
  const { store } = options, now = options.now ?? Date.now;
  const stats = { written: 0, failed: 0, dropped: 0 };
  /** a workspace's report section; never throws and never delays the report */
  async function ingest(accountId: string | null, workspaceId: string, report: UsageReport) {
    if (!accountId || options.optedOut(accountId)) { stats.dropped++; return; }
    try {
      const summaries = !options.summariesOff(accountId);
      const records: UsageRecord[] = [
        ...report.turns.map(data => ({ id: data.id, kind: "turn" as const, at: data.at, accountId, workspaceId, data })),
        ...report.runs.map(data => ({ id: data.id, kind: "run" as const, at: data.at, accountId, workspaceId, data })),
        ...(report.frustrations ?? []).map(data => ({ id: data.id, kind: "frustration" as const, at: data.at, accountId, workspaceId, data: summaries ? data : { ...data, summary: undefined } })),
        ...(summaries ? report.digests ?? [] : []).map(data => ({ id: data.id, kind: "digest" as const, at: data.at, accountId, workspaceId, data })),
      ];
      const fresh = await store.insert(records);
      const writes: Array<Promise<unknown>> = [];
      for (const [day, inc] of rollup(fresh)) writes.push(store.bump(day, inc));
      const perDay = new Map<string, { turns: number; failed: number; runs: number; frustrations: number; appTurns: number }>();
      for (const record of fresh) {
        const day = dayOf(record.at), row = perDay.get(day) ?? { turns: 0, failed: 0, runs: 0, frustrations: 0, appTurns: 0 };
        if (record.kind === "turn") { row.turns++; if ((record.data as UsageTurn).outcome === "failed") row.failed++; if ((record.data as UsageTurn).apps.length) row.appTurns++; }
        if (record.kind === "run") row.runs++;
        if (record.kind === "frustration") row.frustrations++;
        perDay.set(day, row);
      }
      for (const [day, inc] of perDay) writes.push(store.person(day, accountId, inc).then(first => first ? store.bump(day, { people: 1 }) : undefined));
      if (report.snapshot) writes.push(store.snapshot({ workspaceId, accountId, at: now(), snapshot: report.snapshot }));
      await Promise.all(writes);
      for (const record of fresh) if (record.kind === "frustration" && options.newProblem) {
        const f = record.data as UsageFrustration, key = problemKey(f);
        if (await store.once(`problem|${key}`)) options.newProblem({ key, example: f.summary ?? null, count: 1 });
      }
      stats.written += fresh.length;
    } catch { stats.failed++; }
  }
  return { store, stats, ingest, forget: (accountId: string) => store.forget(accountId).catch(() => { stats.failed++; }),
    forgetWorkspace: (workspaceId: string) => store.forgetWorkspace(workspaceId).catch(() => { stats.failed++; }) };
}
export type Usage = ReturnType<typeof createUsage>;

export const REASON_WORDS: Record<(typeof USAGE_REASONS)[number], string> = {
  rate_limit: "hit rate limits", quota: "ran out of plan usage", auth: "sign-in expired or was refused", timeout: "timed out", network: "network trouble",
  context: "the chat got too long", refused: "the ai refused", crashed: "the engine crashed", tool: "a tool broke", unknown: "no clear reason",
};
