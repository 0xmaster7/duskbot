import type { Db } from "mongodb";

/** samples and daily rows are kept this long; ops_latest and ops_rules hold one document per source and per rule */
export const OPS_RETENTION_DAYS = 90;

export interface OpsLatest { source: string; at: number; ok: boolean; error: string | null; data: unknown }
export interface OpsSample { source: string; at: number; data: unknown }
/** one day of one counter: a tunnel's relay bytes, an installation's tool calls, an address's signups */
export interface OpsDaily { source: string; day: string; key: string; accountId: string | null; values: Record<string, number> }
export interface OpsRuleState {
  id: string; state: "ok" | "pending" | "firing"; since: number | null; value: string | null;
  incidentId: string | null; lastFiredAt: number | null; updatedAt: number;
}

export interface OpsStore {
  setLatest(entry: OpsLatest): Promise<void>;
  latest(): Promise<OpsLatest[]>;
  addSample(sample: OpsSample): Promise<void>;
  samples(source: string, since: number, limit?: number): Promise<OpsSample[]>;
  /** replaces each (source, day, key) row */
  putDaily(rows: readonly OpsDaily[]): Promise<void>;
  /** adds to each (source, day, key) row's values */
  addDaily(rows: readonly OpsDaily[]): Promise<void>;
  daily(source: string, fromDay: string, toDay: string): Promise<OpsDaily[]>;
  rules(): Promise<OpsRuleState[]>;
  putRules(states: readonly OpsRuleState[]): Promise<void>;
}

const dailyId = (row: Pick<OpsDaily, "source" | "day" | "key">) => `${row.source}|${row.day}|${row.key}`;

export function memoryOpsStore(): OpsStore {
  const latest = new Map<string, OpsLatest>(), samples: OpsSample[] = [], daily = new Map<string, OpsDaily>(), rules = new Map<string, OpsRuleState>();
  return {
    async setLatest(entry) { latest.set(entry.source, structuredClone(entry)); },
    async latest() { return [...latest.values()].map(entry => structuredClone(entry)); },
    async addSample(sample) { samples.push(structuredClone(sample)); if (samples.length > 20_000) samples.splice(0, samples.length - 20_000); },
    async samples(source, since, limit = 2000) { return samples.filter(s => s.source === source && s.at >= since).sort((a, b) => a.at - b.at).slice(-limit); },
    async putDaily(rows) { for (const row of rows) daily.set(dailyId(row), structuredClone(row)); },
    async addDaily(rows) {
      for (const row of rows) {
        const found = daily.get(dailyId(row)) ?? { ...row, values: {} };
        for (const [name, n] of Object.entries(row.values)) found.values[name] = (found.values[name] ?? 0) + n;
        found.accountId = row.accountId ?? found.accountId;
        daily.set(dailyId(row), found);
      }
    },
    async daily(source, fromDay, toDay) { return [...daily.values()].filter(row => row.source === source && row.day >= fromDay && row.day <= toDay).map(row => structuredClone(row)); },
    async rules() { return [...rules.values()].map(rule => ({ ...rule })); },
    async putRules(states) { for (const state of states) rules.set(state.id, { ...state }); },
  };
}

interface LatestDoc { _id: string; at: Date; ok: boolean; error: string | null; data: unknown }
interface SampleDoc { source: string; at: Date; data: unknown }
interface DailyDoc { _id: string; source: string; day: string; key: string; accountId: string | null; values: Record<string, number>; at: Date }
type RuleDoc = Omit<OpsRuleState, "id"> & { _id: string };

/** ops_latest (one per source), ops_samples and ops_daily (gone after 90 days), ops_rules (one per alert rule) */
export async function mongoOpsStore(db: Db): Promise<OpsStore> {
  const latest = db.collection<LatestDoc>("ops_latest"), samples = db.collection<SampleDoc>("ops_samples");
  const daily = db.collection<DailyDoc>("ops_daily"), rules = db.collection<RuleDoc>("ops_rules");
  const ttl = OPS_RETENTION_DAYS * 86_400;
  await Promise.all([
    samples.createIndexes([{ key: { at: 1 }, expireAfterSeconds: ttl }, { key: { source: 1, at: -1 } }]),
    daily.createIndexes([{ key: { at: 1 }, expireAfterSeconds: ttl }, { key: { source: 1, day: 1 } }]),
  ]);
  const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
  return {
    async setLatest(entry) { await latest.replaceOne({ _id: entry.source }, { at: new Date(entry.at), ok: entry.ok, error: entry.error, data: entry.data }, { upsert: true }); },
    async latest() { return (await latest.find({}).toArray()).map(doc => ({ source: doc._id, at: doc.at.getTime(), ok: doc.ok, error: doc.error, data: doc.data })); },
    async addSample(sample) { await samples.insertOne({ source: sample.source, at: new Date(sample.at), data: sample.data }); },
    async samples(source, since, limit = 2000) {
      const docs = await samples.find({ source, at: { $gte: new Date(since) } }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray();
      return docs.reverse().map(doc => ({ source: doc.source, at: doc.at.getTime(), data: doc.data }));
    },
    async putDaily(rows) {
      if (!rows.length) return;
      await daily.bulkWrite(rows.map(row => ({ replaceOne: { filter: { _id: dailyId(row) }, replacement: { source: row.source, day: row.day, key: row.key, accountId: row.accountId, values: row.values, at: dayDate(row.day) }, upsert: true } })), { ordered: false });
    },
    async addDaily(rows) {
      if (!rows.length) return;
      await daily.bulkWrite(rows.map(row => ({ updateOne: { filter: { _id: dailyId(row) }, upsert: true,
        update: { $inc: Object.fromEntries(Object.entries(row.values).map(([name, n]) => [`values.${name}`, n])), $set: { at: dayDate(row.day), ...(row.accountId ? { accountId: row.accountId } : {}) },
          $setOnInsert: { source: row.source, day: row.day, key: row.key, ...(row.accountId ? {} : { accountId: null }) } } } })), { ordered: false });
    },
    async daily(source, fromDay, toDay) {
      return (await daily.find({ source, day: { $gte: fromDay, $lte: toDay } }).toArray()).map(doc => ({ source: doc.source, day: doc.day, key: doc.key, accountId: doc.accountId ?? null, values: doc.values ?? {} }));
    },
    async rules() { return (await rules.find({}).toArray()).map(({ _id, ...rest }) => ({ id: _id, ...rest })); },
    async putRules(states) {
      if (!states.length) return;
      await rules.bulkWrite(states.map(({ id, ...rest }) => ({ replaceOne: { filter: { _id: id }, replacement: rest, upsert: true } })), { ordered: false });
    },
  };
}
