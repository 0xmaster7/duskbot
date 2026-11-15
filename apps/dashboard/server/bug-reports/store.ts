import type { Db } from "mongodb";
import { MongoServerError } from "mongodb";

/** what the owner sets in admin; the desktop hears "fixed" for fixed and "received" for the rest */
export const BUG_REPORT_STATUSES = ["new", "looking", "fixed", "wont-fix"] as const;
export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number];

/** one @devs report as admin lists it (no diagnostics); times are epoch ms */
export interface BugReportRow {
  id: string;
  installId: string;
  source: string;
  description: string;
  appVersion: string;
  platform: string;
  contact: string | null;
  status: BugReportStatus;
  fixedIn: string | null;
  receivedAt: number;
  updatedAt: number;
  notifiedAt: number | null;
}
export interface BugReport extends BugReportRow { diagnostics: string }
export type NewBugReport = Omit<BugReport, "status" | "fixedIn" | "updatedAt" | "notifiedAt"> & { hash: string };

export interface BugReportStore {
  /** the report kept; when the same install already sent these exact bytes, that one instead (a retry whose answer was lost) */
  add(report: NewBugReport, dedupeSince: number): Promise<{ report: BugReportRow; fresh: boolean }>;
  list(options: { limit: number; before?: number; status?: BugReportStatus }): Promise<BugReportRow[]>;
  get(id: string): Promise<BugReport | null>;
  counts(): Promise<Record<BugReportStatus, number>>;
  setStatus(id: string, status: BugReportStatus, fixedIn: string | null, at: number): Promise<BugReportRow | null>;
  /** only this install's own reports among `ids` */
  statuses(installId: string, ids: string[]): Promise<Array<{ id: string; status: BugReportStatus; fixedIn: string | null }>>;
  /** true once per report: whoever claims it sends its one email */
  claimNotify(id: string, at: number): Promise<boolean>;
}

interface BugReportDoc {
  _id: string; installId: string; source: string; description: string; appVersion: string; platform: string; diagnostics: string;
  contact: string | null; hash: string; status: BugReportStatus; fixedIn: string | null; receivedAt: Date; updatedAt: Date; notifiedAt: Date | null;
}
const LIST_FIELDS = { diagnostics: 0, hash: 0 } as const;
const row = (doc: Omit<BugReportDoc, "diagnostics" | "hash">): BugReportRow => ({ id: doc._id, installId: doc.installId, source: doc.source, description: doc.description,
  appVersion: doc.appVersion, platform: doc.platform, contact: doc.contact ?? null, status: doc.status, fixedIn: doc.fixedIn ?? null,
  receivedAt: doc.receivedAt.getTime(), updatedAt: doc.updatedAt.getTime(), notifiedAt: doc.notifiedAt?.getTime() ?? null });
const zero = (): Record<BugReportStatus, number> => ({ new: 0, looking: 0, fixed: 0, "wont-fix": 0 });

/** one document per report, kept until the owner removes it by hand; `_id` is the id the person sees */
export async function mongoBugReportStore(db: Db): Promise<BugReportStore> {
  const reports = db.collection<BugReportDoc>("bug_reports");
  await reports.createIndexes([{ key: { receivedAt: -1 } }, { key: { status: 1, receivedAt: -1 } }, { key: { installId: 1, hash: 1, receivedAt: -1 } }]);
  return {
    async add(report, dedupeSince) {
      const same = await reports.findOne({ installId: report.installId, hash: report.hash, receivedAt: { $gte: new Date(dedupeSince) } }, { projection: LIST_FIELDS });
      if (same) return { report: row(same), fresh: false };
      const at = new Date(report.receivedAt);
      const doc: BugReportDoc = { _id: report.id, installId: report.installId, source: report.source, description: report.description, appVersion: report.appVersion,
        platform: report.platform, diagnostics: report.diagnostics, contact: report.contact, hash: report.hash, status: "new", fixedIn: null, receivedAt: at, updatedAt: at, notifiedAt: null };
      try { await reports.insertOne(doc); }
      catch (error) { if (error instanceof MongoServerError && error.code === 11000) throw new Error("bug report id taken"); throw error; }
      return { report: row(doc), fresh: true };
    },
    async list({ limit, before, status }) {
      const filter = { ...(status ? { status } : {}), ...(before !== undefined ? { receivedAt: { $lt: new Date(before) } } : {}) };
      return (await reports.find(filter, { projection: LIST_FIELDS }).sort({ receivedAt: -1 }).limit(limit).toArray()).map(row);
    },
    async get(id) {
      const doc = await reports.findOne({ _id: id }, { projection: { hash: 0 } });
      return doc ? { ...row(doc), diagnostics: doc.diagnostics } : null;
    },
    async counts() {
      const out = zero();
      for (const item of await reports.aggregate<{ _id: BugReportStatus; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray()) if (item._id in out) out[item._id] = item.n;
      return out;
    },
    async setStatus(id, status, fixedIn, at) {
      const doc = await reports.findOneAndUpdate({ _id: id }, { $set: { status, fixedIn, updatedAt: new Date(at) } }, { returnDocument: "after", projection: LIST_FIELDS });
      return doc ? row(doc) : null;
    },
    async statuses(installId, ids) {
      if (!ids.length) return [];
      return (await reports.find({ _id: { $in: ids }, installId }, { projection: { status: 1, fixedIn: 1 } }).toArray()).map(doc => ({ id: doc._id, status: doc.status, fixedIn: doc.fixedIn ?? null }));
    },
    async claimNotify(id, at) {
      return (await reports.updateOne({ _id: id, notifiedAt: null }, { $set: { notifiedAt: new Date(at) } })).modifiedCount === 1;
    },
  };
}

/** development and tests: gone on restart */
export function memoryBugReportStore(): BugReportStore & { all: Map<string, BugReport & { hash: string }> } {
  const all = new Map<string, BugReport & { hash: string }>();
  const view = ({ diagnostics: _d, hash: _h, ...rest }: BugReport & { hash: string }): BugReportRow => ({ ...rest });
  return {
    all,
    async add(report, dedupeSince) {
      const same = [...all.values()].find(item => item.installId === report.installId && item.hash === report.hash && item.receivedAt >= dedupeSince);
      if (same) return { report: view(same), fresh: false };
      if (all.has(report.id)) throw new Error("bug report id taken");
      const kept = { ...report, status: "new" as const, fixedIn: null, updatedAt: report.receivedAt, notifiedAt: null };
      all.set(report.id, kept);
      return { report: view(kept), fresh: true };
    },
    async list({ limit, before, status }) {
      return [...all.values()].filter(item => (!status || item.status === status) && (before === undefined || item.receivedAt < before))
        .sort((a, b) => b.receivedAt - a.receivedAt).slice(0, limit).map(view);
    },
    async get(id) { const item = all.get(id); if (!item) return null; const { hash: _h, ...rest } = item; return { ...rest }; },
    async counts() { const out = zero(); for (const item of all.values()) out[item.status]++; return out; },
    async setStatus(id, status, fixedIn, at) { const item = all.get(id); if (!item) return null; Object.assign(item, { status, fixedIn, updatedAt: at }); return view(item); },
    async statuses(installId, ids) { return ids.flatMap(id => { const item = all.get(id); return item && item.installId === installId ? [{ id, status: item.status, fixedIn: item.fixedIn }] : []; }); },
    async claimNotify(id, at) { const item = all.get(id); if (!item || item.notifiedAt !== null) return false; item.notifiedAt = at; return true; },
  };
}
