import { MongoClient, type Db } from "mongodb";
import { readonlySink, type AnalyticsSink } from "../analytics/sink.ts";
import type { Account } from "../auth/store.ts";

/** another service's analytics the admin reads, never writes: preview's admin showing dusk.bot's visitors, sessions and
 *  sign-ups from dusk_prod. its money, clouds and devices stay on that service's own admin. */
export interface LiveData {
  label: string;
  sink: AnalyticsSink;
  /** that service's accounts, only what the analytics pages name people with */
  accounts(): Promise<Account[]>;
}

export function liveData(db: Db, label: string, now: () => number = Date.now, ttlMs = 30_000): LiveData {
  const rows = db.collection<Account>("accounts");
  let cached: { at: number; list: Promise<Account[]> } | null = null;
  return {
    label, sink: readonlySink(db),
    accounts() {
      if (!cached || now() - cached.at > ttlMs) {
        const list = rows.find({}, { projection: { _id: 0, id: 1, email: 1, name: 1, createdAt: 1 } }).sort({ _n: 1 }).limit(100_000).toArray()
          .then(docs => docs.map(doc => ({ id: doc.id, email: doc.email, name: doc.name ?? null, createdAt: doc.createdAt })));
        cached = { at: now(), list };
        list.catch(() => { if (cached?.list === list) cached = null; });
      }
      return cached.list;
    },
  };
}

/** DUSK_ADMIN_ANALYTICS_URI names a user with only `read` on DUSK_ADMIN_ANALYTICS_DB */
export async function openLiveData(uri: string, dbName: string, label: string): Promise<LiveData> {
  if (!/^[a-z0-9_]{1,40}$/.test(dbName)) throw new Error("DUSK_ADMIN_ANALYTICS_DB must be a database name.");
  const client = new MongoClient(uri, { maxPoolSize: 4, serverSelectionTimeoutMS: 10_000, appName: "dusk-admin-live" });
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  return liveData(db, label);
}
