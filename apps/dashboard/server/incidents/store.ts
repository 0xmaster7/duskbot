import type { Db } from "mongodb";
import { MongoServerError } from "mongodb";

export const RETENTION_DAYS = 30;

/** GET /v1/admin/incidents returns these; times are epoch ms */
export interface Incident {
  id: string;
  env: string;
  source: string;
  name: string;
  message: string;
  route: string | null;
  status: number | null;
  stack: string[];
  version: string | null;
  os: string | null;
  path: string | null;
  requestId: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  notifiedAt: number | null;
  mutedUntil: number | null;
}
export type IncidentSample = Omit<Incident, "count" | "firstSeen" | "notifiedAt" | "mutedUntil">;

export interface IncidentStore {
  /** adds `add` sightings; the sample fields are the newest sighting's */
  record(batch: Array<{ sample: IncidentSample; add: number; firstSeen: number }>): Promise<void>;
  notified(ids: string[], at: number): Promise<void>;
  mute(id: string, until: number | null): Promise<boolean>;
  list(options: { limit: number; before?: number; source?: string; since?: number }): Promise<Incident[]>;
  /** true the first time a key is claimed: a restart never sends the same daily summary twice */
  once(key: string, expiresAt: number): Promise<boolean>;
}

interface IncidentDoc {
  _id: string; env: string; source: string; name: string; message: string; route: string | null; status: number | null; stack: string[];
  version: string | null; os: string | null; path: string | null; requestId: string | null;
  count: number; firstSeen: Date; lastSeen: Date; notifiedAt?: Date | null; mutedUntil?: Date | null;
}
const view = (doc: IncidentDoc): Incident => ({ id: doc._id, env: doc.env, source: doc.source, name: doc.name, message: doc.message, route: doc.route, status: doc.status ?? null,
  stack: doc.stack ?? [], version: doc.version, os: doc.os, path: doc.path, requestId: doc.requestId, count: doc.count, firstSeen: doc.firstSeen.getTime(),
  lastSeen: doc.lastSeen.getTime(), notifiedAt: doc.notifiedAt?.getTime() ?? null, mutedUntil: doc.mutedUntil?.getTime() ?? null });

/** only the sample's own fields are set: count and firstSeen have their own operators, and MongoDB refuses one path in two */
export function recordUpdate(sample: IncidentSample, add: number, firstSeen: number) {
  const { env, source, name, message, route, status, stack, version, os, path, requestId, lastSeen } = sample;
  return { $inc: { count: add }, $set: { env, source, name, message, route, status, stack, version, os, path, requestId, lastSeen: new Date(lastSeen) },
    $setOnInsert: { firstSeen: new Date(firstSeen), notifiedAt: null, mutedUntil: null } };
}

/** one document per fingerprint, gone 30 days after it was last seen */
export async function mongoIncidentStore(db: Db): Promise<IncidentStore> {
  const incidents = db.collection<IncidentDoc>("incidents");
  const marks = db.collection<{ _id: string; expiresAt: Date }>("incident_marks");
  await Promise.all([
    incidents.createIndexes([{ key: { lastSeen: 1 }, expireAfterSeconds: RETENTION_DAYS * 86_400 }, { key: { source: 1, lastSeen: -1 } }]),
    marks.createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }]),
  ]);
  return {
    async record(batch) {
      if (!batch.length) return;
      await incidents.bulkWrite(batch.map(({ sample, add, firstSeen }) => ({ updateOne: { filter: { _id: sample.id }, upsert: true, update: recordUpdate(sample, add, firstSeen) } })), { ordered: false });
    },
    async notified(ids, at) {
      if (ids.length) await incidents.updateMany({ _id: { $in: ids } }, { $set: { notifiedAt: new Date(at) } });
    },
    async mute(id, until) {
      const result = await incidents.updateOne({ _id: id }, { $set: { mutedUntil: until === null ? null : new Date(until) } });
      return result.matchedCount > 0;
    },
    async list({ limit, before, source, since }) {
      const lastSeen = { ...(before !== undefined ? { $lt: new Date(before) } : {}), ...(since !== undefined ? { $gte: new Date(since) } : {}) };
      const filter = { ...(source ? { source } : {}), ...(Object.keys(lastSeen).length ? { lastSeen } : {}) };
      return (await incidents.find(filter).sort({ lastSeen: -1 }).limit(limit).toArray()).map(view);
    },
    async once(key, expiresAt) {
      try { await marks.insertOne({ _id: key, expiresAt: new Date(expiresAt) }); return true; }
      catch (error) { if (error instanceof MongoServerError && error.code === 11000) return false; throw error; }
    },
  };
}

export function memoryIncidentStore(): IncidentStore & { all: Map<string, Incident> } {
  const all = new Map<string, Incident>(), marks = new Set<string>();
  return {
    all,
    async record(batch) {
      for (const { sample, add, firstSeen } of batch) {
        const old = all.get(sample.id);
        all.set(sample.id, { ...sample, count: (old?.count ?? 0) + add, firstSeen: old?.firstSeen ?? firstSeen, notifiedAt: old?.notifiedAt ?? null, mutedUntil: old?.mutedUntil ?? null });
      }
    },
    async notified(ids, at) { for (const id of ids) { const item = all.get(id); if (item) item.notifiedAt = at; } },
    async mute(id, until) { const item = all.get(id); if (item) item.mutedUntil = until; return !!item; },
    async list({ limit, before, source, since }) {
      return [...all.values()].filter(item => (!source || item.source === source) && (before === undefined || item.lastSeen < before) && (since === undefined || item.lastSeen >= since))
        .sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit).map(item => ({ ...item }));
    },
    async once(key) { if (marks.has(key)) return false; marks.add(key); return true; },
  };
}
