import type { Db } from "mongodb";
import { DAY_MS, RAW_RETENTION_DAYS, type Props } from "./events.ts";
import type { EventContext } from "./context.ts";

export interface StoredEvent { id: string; name: string; at: number; accountId: string | null; props: Props; ctx?: EventContext }
export interface AuditEntry { id: string; at: number; actor: string; action: string; target: string | null; detail: Record<string, string | number | boolean | null> }
/** one request from an AI assistant's crawler to the site: which bot, what for, which page */
export interface Crawl { at: number; bot: string; kind: "answers" | "indexing" | "training"; path: string; host: string | null }
/** crawler requests are capped, not kept: the newest this many */
export const CRAWL_CAP = 200_000;
/** a chart note: a launch, a post, a release, pinned to a time */
export interface Note { id: string; at: number; text: string; by: string; createdAt: number }
/** the most raw events one dashboard read scans; beyond it the read uses the newest ones and says so */
export const SCAN_LIMIT = 400_000;
export interface EventQuery { accountId?: string; name?: string; since?: number; before?: number; limit: number }

/** where analytics live: MongoDB in production, memory in tests and fixtures */
export interface AnalyticsSink {
  insert(event: StoredEvent): Promise<void>;
  /** adds to the kept daily count of a name */
  bump(day: string, name: string, by?: number): Promise<void>;
  /** true the first time a key is seen; `expiresAt` null keeps the mark forever */
  once(key: string, expiresAt: number | null): Promise<boolean>;
  daily(names: string[], fromDay: string, toDay: string): Promise<Array<{ day: string; name: string; count: number }>>;
  events(query: EventQuery): Promise<StoredEvent[]>;
  counts(since: number, until: number): Promise<Array<{ name: string; count: number }>>;
  /** distinct accounts with any of these events since a time */
  accounts(names: string[], since: number): Promise<Set<string>>;
  /** removes every raw event of an account (its deletion, or opting out) */
  forget(accountId: string): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
  auditLog(limit: number, before?: number): Promise<AuditEntry[]>;
  /** the newest entries whose target is one of these ids, without the skipped actions */
  auditFor(targets: string[], limit: number, skipActions?: string[]): Promise<AuditEntry[]>;
  health(): Promise<{ ok: boolean; detail: string; latencyMs: number | null }>;
  /** raw events in [since, until), oldest first, optionally only some names */
  scan(since: number, until: number, names?: readonly string[]): Promise<StoredEvent[]>;
  notes(since: number, until: number): Promise<Note[]>;
  saveNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<boolean>;
  crawl(entry: Crawl): Promise<void>;
  crawls(since: number, until: number): Promise<Crawl[]>;
}

export function memorySink(now: () => number = Date.now): AnalyticsSink & { all: StoredEvent[]; daySums: Map<string, number> } {
  let all: StoredEvent[] = [];
  const daySums = new Map<string, number>(), marks = new Map<string, number | null>(), audits: AuditEntry[] = [], notes = new Map<string, Note>(), crawlLog: Crawl[] = [];
  const match = (event: StoredEvent, q: Omit<EventQuery, "limit">) => (q.accountId === undefined || event.accountId === q.accountId) && (q.name === undefined || event.name === q.name)
    && (q.since === undefined || event.at >= q.since) && (q.before === undefined || event.at < q.before);
  return {
    all, daySums,
    async insert(event) {
      all.push(event);
      const cutoff = now() - RAW_RETENTION_DAYS * DAY_MS;
      if (all[0] && all[0].at < cutoff) { all = all.filter(item => item.at >= cutoff); this.all = all; }
    },
    async bump(day, name, by = 1) { const key = `${day}|${name}`; daySums.set(key, (daySums.get(key) ?? 0) + by); },
    async once(key, expiresAt) {
      const existing = marks.get(key);
      if (existing !== undefined && (existing === null || existing > now())) return false;
      marks.set(key, expiresAt); return true;
    },
    async daily(names, fromDay, toDay) {
      return [...daySums].map(([key, count]) => { const [day, name] = key.split("|") as [string, string]; return { day, name, count }; })
        .filter(row => names.includes(row.name) && row.day >= fromDay && row.day <= toDay);
    },
    async events(q) { return all.filter(event => match(event, q)).sort((a, b) => b.at - a.at).slice(0, q.limit); },
    async counts(since, until) {
      const by = new Map<string, number>();
      for (const event of all) if (event.at >= since && event.at < until) by.set(event.name, (by.get(event.name) ?? 0) + 1);
      return [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    },
    async accounts(names, since) { return new Set(all.filter(event => event.accountId && names.includes(event.name) && event.at >= since).map(event => event.accountId!)); },
    async forget(accountId) { all = all.filter(event => event.accountId !== accountId); this.all = all; },
    async audit(entry) { audits.push(entry); },
    async auditLog(limit, before) { return audits.filter(entry => before === undefined || entry.at < before).sort((a, b) => b.at - a.at).slice(0, limit); },
    async auditFor(targets, limit, skipActions = []) { return audits.filter(entry => entry.target !== null && targets.includes(entry.target) && !skipActions.includes(entry.action)).sort((a, b) => b.at - a.at).slice(0, limit); },
    async health() { return { ok: true, detail: "memory (fixture)", latencyMs: null }; },
    async scan(since, until, names) {
      return all.filter(event => event.at >= since && event.at < until && (!names || names.includes(event.name))).sort((a, b) => a.at - b.at).slice(-SCAN_LIMIT);
    },
    async notes(since, until) { return [...notes.values()].filter(note => note.at >= since && note.at < until).sort((a, b) => a.at - b.at); },
    async saveNote(note) { notes.set(note.id, note); },
    async deleteNote(id) { return notes.delete(id); },
    async crawl(entry) { crawlLog.push(entry); if (crawlLog.length > CRAWL_CAP) crawlLog.splice(0, crawlLog.length - CRAWL_CAP); },
    async crawls(since, until) { return crawlLog.filter(entry => entry.at >= since && entry.at < until); },
  };
}

type EventDoc = { _id: string; name: string; at: Date; accountId: string | null; props: Props; ctx?: EventContext };
type AuditDoc = Omit<AuditEntry, "id" | "at"> & { _id: string; at: Date };

/** analytics_events (TTL on `at`), analytics_daily (kept), analytics_marks (TTL on `expiresAt`), admin_audit (kept) */
export async function mongoSink(db: Db): Promise<AnalyticsSink> {
  const events = db.collection<EventDoc>("analytics_events"), daily = db.collection<{ _id: string; day: string; name: string; count: number }>("analytics_daily");
  const marks = db.collection<{ _id: string; expiresAt: Date | null }>("analytics_marks"), audits = db.collection<AuditDoc>("admin_audit");
  const notes = db.collection<{ _id: string; at: Date; text: string; by: string; createdAt: Date }>("analytics_notes");
  if (!(await db.listCollections({ name: "analytics_crawls" }, { nameOnly: true }).toArray()).length) {
    await db.createCollection("analytics_crawls", { capped: true, size: 64 * 1024 * 1024, max: CRAWL_CAP }).catch((error: { code?: number }) => { if (error.code !== 48) throw error; });
  }
  const crawlCollection = db.collection<{ at: Date; bot: string; kind: Crawl["kind"]; path: string; host: string | null }>("analytics_crawls");
  await Promise.all([
    events.createIndexes([{ key: { at: 1 }, expireAfterSeconds: RAW_RETENTION_DAYS * 86_400 }, { key: { accountId: 1, at: -1 } }, { key: { name: 1, at: -1 } }, { key: { "ctx.session": 1, at: 1 }, sparse: true }]),
    daily.createIndexes([{ key: { day: 1, name: 1 } }]),
    marks.createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: "date" } } }]),
    audits.createIndexes([{ key: { at: -1 } }, { key: { target: 1, at: -1 } }]),
    notes.createIndexes([{ key: { at: 1 } }]),
  ]);
  const toEvent = (doc: EventDoc): StoredEvent => ({ id: doc._id, name: doc.name, at: doc.at.getTime(), accountId: doc.accountId, props: doc.props ?? {}, ...(doc.ctx ? { ctx: doc.ctx } : {}) });
  return {
    async insert(event) { await events.insertOne({ _id: event.id, name: event.name, at: new Date(event.at), accountId: event.accountId, props: event.props, ...(event.ctx ? { ctx: event.ctx } : {}) }); },
    async bump(day, name, by = 1) { await daily.updateOne({ _id: `${day}|${name}` }, { $setOnInsert: { day, name }, $inc: { count: by } }, { upsert: true }); },
    async once(key, expiresAt) {
      const until = expiresAt === null ? null : new Date(expiresAt);
      try { await marks.insertOne({ _id: key, expiresAt: until }); return true; } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
      const existing = await marks.findOne({ _id: key });
      if (!existing?.expiresAt || existing.expiresAt.getTime() > Date.now()) return false;
      return (await marks.updateOne({ _id: key, expiresAt: existing.expiresAt }, { $set: { expiresAt: until } })).modifiedCount === 1;
    },
    async daily(names, fromDay, toDay) {
      return (await daily.find({ name: { $in: names }, day: { $gte: fromDay, $lte: toDay } }).toArray()).map(({ day, name, count }) => ({ day, name, count }));
    },
    async events(q) {
      const at: Record<string, Date> = {};
      if (q.since !== undefined) at.$gte = new Date(q.since);
      if (q.before !== undefined) at.$lt = new Date(q.before);
      const filter = { ...(q.accountId === undefined ? {} : { accountId: q.accountId }), ...(q.name === undefined ? {} : { name: q.name }), ...(Object.keys(at).length ? { at } : {}) };
      return (await events.find(filter).sort({ at: -1 }).limit(q.limit).toArray()).map(toEvent);
    },
    async counts(since, until) {
      const rows = await events.aggregate<{ _id: string; count: number }>([{ $match: { at: { $gte: new Date(since), $lt: new Date(until) } } }, { $group: { _id: "$name", count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray();
      return rows.map(row => ({ name: row._id, count: row.count }));
    },
    async accounts(names, since) {
      return new Set((await events.distinct("accountId", { name: { $in: names }, at: { $gte: new Date(since) }, accountId: { $type: "string" } })) as string[]);
    },
    async forget(accountId) { await events.deleteMany({ accountId }); },
    async audit(entry) { const { id, at, ...rest } = entry; await audits.insertOne({ _id: id, at: new Date(at), ...rest }); },
    async auditLog(limit, before) {
      return (await audits.find(before === undefined ? {} : { at: { $lt: new Date(before) } }).sort({ at: -1 }).limit(limit).toArray())
        .map(({ _id, at, ...rest }) => ({ id: _id, at: at.getTime(), ...rest }));
    },
    async auditFor(targets, limit, skipActions = []) {
      return (await audits.find({ target: { $in: targets }, ...(skipActions.length ? { action: { $nin: skipActions } } : {}) }).sort({ at: -1 }).limit(limit).toArray()).map(({ _id, at, ...rest }) => ({ id: _id, at: at.getTime(), ...rest }));
    },
    async scan(since, until, names) {
      const filter = { at: { $gte: new Date(since), $lt: new Date(until) }, ...(names ? { name: { $in: [...names] } } : {}) };
      const docs = await events.find(filter).sort({ at: -1 }).limit(SCAN_LIMIT).toArray();
      return docs.reverse().map(toEvent);
    },
    async notes(since, until) {
      return (await notes.find({ at: { $gte: new Date(since), $lt: new Date(until) } }).sort({ at: 1 }).toArray())
        .map(doc => ({ id: doc._id, at: doc.at.getTime(), text: doc.text, by: doc.by, createdAt: doc.createdAt.getTime() }));
    },
    async saveNote(note) { await notes.replaceOne({ _id: note.id }, { at: new Date(note.at), text: note.text, by: note.by, createdAt: new Date(note.createdAt) }, { upsert: true }); },
    async deleteNote(id) { return (await notes.deleteOne({ _id: id })).deletedCount === 1; },
    async crawl(entry) { await crawlCollection.insertOne({ ...entry, at: new Date(entry.at) }); },
    async crawls(since, until) {
      return (await crawlCollection.find({ at: { $gte: new Date(since), $lt: new Date(until) } }).toArray()).map(({ at, bot, kind, path, host }) => ({ at: at.getTime(), bot, kind, path, host }));
    },
    async health() {
      const started = performance.now();
      try { await db.command({ ping: 1 }); return { ok: true, detail: "mongodb", latencyMs: Math.round(performance.now() - started) }; } catch { return { ok: false, detail: "mongodb ping failed", latencyMs: null }; }
    },
  };
}
