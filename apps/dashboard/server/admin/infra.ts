import type { Db } from "mongodb";
import { instaboxUsageCents } from "../../../cloud-service/src/instabox.ts";
import type { StoredCloud } from "../clouds/types.ts";
import { DAY, dayKey } from "./metrics.ts";

export interface MachineUsage { runningSeconds: number; vcpuSeconds: number; memGiBSeconds: number; diskGiBSeconds: number; egressBytes: number }
/** one managed cloud's measured InstaBox usage over one UTC day, and what it cost at InstaBox's list prices */
export interface InfraDay {
  day: string; cloudId: string; accountId: string; serverId: string;
  runningSeconds: number; vcpuSeconds: number; memGiBSeconds: number; diskGiBSeconds: number; egressBytes: number;
  computeCents: number; diskCents: number; costCents: number; collectedAt: number;
}
export interface InfraStore {
  /** replaces each (day, cloudId) row: collecting a day again overwrites it */
  put(rows: readonly InfraDay[]): Promise<void>;
  range(fromDay: string, toDay: string): Promise<InfraDay[]>;
}

/** InstaBox bills /data at $0.08 per GiB-month only beyond the workspace's 200 GiB pool; charging every GiB is an upper bound */
export const DISK_CENTS_PER_GIB_MONTH = 8;
const MONTH_SECONDS = 730 * 3600;
/** Dodo's cut of each subscription charge */
export const DODO_FEE = { rate: 0.06, fixedCents: 40 } as const;

const round = (n: number) => Math.round(n * 10_000) / 10_000;
export function costOf(usage: Pick<MachineUsage, "vcpuSeconds" | "memGiBSeconds" | "diskGiBSeconds">) {
  const computeCents = round(instaboxUsageCents(usage)), diskCents = round(usage.diskGiBSeconds / MONTH_SECONDS * DISK_CENTS_PER_GIB_MONTH);
  return { computeCents, diskCents, costCents: round(computeCents + diskCents) };
}

export function memoryInfraStore(): InfraStore & { rows: Map<string, InfraDay> } {
  const rows = new Map<string, InfraDay>();
  return {
    rows,
    async put(list) { for (const row of list) rows.set(`${row.day}|${row.cloudId}`, { ...row }); },
    async range(fromDay, toDay) { return [...rows.values()].filter(row => row.day >= fromDay && row.day <= toDay).sort((a, b) => a.day.localeCompare(b.day) || a.cloudId.localeCompare(b.cloudId)); },
  };
}

type InfraDoc = Omit<InfraDay, "collectedAt"> & { _id: string; collectedAt: Date };
/** infra_usage_daily: one document per (day, cloudId), written outside the writer lease; every write replaces a whole row by key */
export async function mongoInfraStore(db: Db): Promise<InfraStore> {
  const days = db.collection<InfraDoc>("infra_usage_daily");
  await days.createIndexes([{ key: { day: 1 } }, { key: { cloudId: 1, day: 1 } }]);
  return {
    async put(list) {
      if (!list.length) return;
      await days.bulkWrite(list.map(row => ({ replaceOne: { filter: { _id: `${row.day}|${row.cloudId}` }, replacement: { ...row, collectedAt: new Date(row.collectedAt) }, upsert: true } })), { ordered: false });
    },
    async range(fromDay, toDay) {
      return (await days.find({ day: { $gte: fromDay, $lte: toDay } }).sort({ day: 1, cloudId: 1 }).toArray()).map(({ _id, collectedAt, ...row }) => ({ ...row, collectedAt: collectedAt.getTime() }));
    },
  };
}

const minus = (a: MachineUsage, b: MachineUsage): MachineUsage => ({
  runningSeconds: Math.max(0, a.runningSeconds - b.runningSeconds), vcpuSeconds: Math.max(0, a.vcpuSeconds - b.vcpuSeconds), memGiBSeconds: Math.max(0, a.memGiBSeconds - b.memGiBSeconds),
  diskGiBSeconds: Math.max(0, a.diskGiBSeconds - b.diskGiBSeconds), egressBytes: Math.max(0, a.egressBytes - b.egressBytes),
});
const startOfDay = (t: number) => Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());

export interface InfraCollectorOptions {
  store: InfraStore;
  clouds: () => readonly StoredCloud[];
  /** the provider's usage of the cloud's current machine from `from` until now; null when it can't be read */
  usage: ((cloud: StoredCloud, from: number) => Promise<MachineUsage | null>) | null;
  now: () => number;
  everyMs?: number;
  concurrency?: number;
}

/** Hourly: yesterday (usage since its start minus usage since today's start) and today so far, per managed cloud with a
 *  machine. The provider only measures "from a time until now", so a day is the difference of two reads. */
export function createInfraCollector(options: InfraCollectorOptions) {
  const { store, now } = options;
  let running: Promise<number> | null = null, closed = false;

  async function collect(cloud: StoredCloud, yesterday: number, today: number, at: number): Promise<InfraDay[]> {
    const usage = options.usage!;
    const [sinceYesterday, sinceToday] = await Promise.all([usage(cloud, yesterday), usage(cloud, today)]);
    const row = (day: number, measured: MachineUsage): InfraDay => ({ day: dayKey(day), cloudId: cloud.id, accountId: cloud.accountId, serverId: cloud.serverId!,
      runningSeconds: measured.runningSeconds, vcpuSeconds: measured.vcpuSeconds, memGiBSeconds: measured.memGiBSeconds, diskGiBSeconds: measured.diskGiBSeconds, egressBytes: measured.egressBytes,
      ...costOf(measured), collectedAt: at });
    const out: InfraDay[] = [];
    if (sinceToday) out.push(row(today, sinceToday));
    if (sinceYesterday && sinceToday) out.push(row(yesterday, minus(sinceYesterday, sinceToday)));
    return out;
  }

  /** collects once; a second call while one runs joins it. Resolves to the rows written. */
  function run(): Promise<number> {
    if (running) return running;
    running = (async () => {
      if (!options.usage) return 0;
      const at = now(), today = startOfDay(at), yesterday = today - DAY;
      const clouds = options.clouds().filter(c => c.backend && c.serverId && c.status !== "destroyed");
      const width = Math.max(1, options.concurrency ?? 4);
      let written = 0, next = 0;
      async function lane() {
        while (next < clouds.length && !closed) {
          const cloud = clouds[next++]!;
          const rows = await collect(cloud, yesterday, today, at).catch(() => []);
          if (rows.length) { await store.put(rows); written += rows.length; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(width, clouds.length) }, lane));
      return written;
    })().finally(() => { running = null; });
    return running;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    store,
    run,
    start() {
      if (timer || !options.usage) return;
      const tick = () => { void run().catch(error => console.warn(`infra: usage collection failed: ${(error as Error).message}`)); };
      setTimeout(tick, 60_000).unref?.();
      timer = setInterval(tick, options.everyMs ?? 3_600_000);
      timer.unref?.();
    },
    close() { closed = true; if (timer) clearInterval(timer); timer = null; },
  };
}

export interface MarginCustomer { accountId: string; email: string | null; plan: string; interval: "month" | "year" | null; status: string; mrr: number }
export const HOUR_BUCKETS = [{ label: "0-1h", min: 0, max: 1 }, { label: "1-4h", min: 1, max: 4 }, { label: "4-8h", min: 4, max: 8 }, { label: "8-12h", min: 8, max: 12 }, { label: "12-24h", min: 12, max: Infinity }] as const;

const feeOf = (customer: Pick<MarginCustomer, "mrr" | "interval">) => customer.mrr > 0 ? customer.mrr * DODO_FEE.rate + (customer.interval === "year" ? DODO_FEE.fixedCents / 12 : DODO_FEE.fixedCents) : 0;
const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 1000 : null;

/** this month's InstaBox cost against MRR. Margin compares a full month of MRR, less Dodo's fee, with the month-to-date
 *  cost scaled to the whole month. */
export function marginReport(input: { now: number; customers: readonly MarginCustomer[]; rows: readonly InfraDay[]; worst?: number; egress?: ReadonlyMap<string, "slowed" | "paused"> }) {
  const at = input.now, start = Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), 1), end = Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth() + 1, 1);
  const elapsed = Math.min(1, Math.max(DAY, at - start) / (end - start));
  const monthDays = new Set<string>(), rows = input.rows.filter(row => row.day >= dayKey(start) && row.day < dayKey(end));
  const byAccount = new Map<string, { compute: number; disk: number; running: number; vcpu: number; diskGiB: number; egress: number }>();
  const byCloud = new Map<string, { running: number; days: number }>();
  for (const row of rows) {
    monthDays.add(row.day);
    const a = byAccount.get(row.accountId) ?? { compute: 0, disk: 0, running: 0, vcpu: 0, diskGiB: 0, egress: 0 };
    a.egress += row.egressBytes; a.compute += row.computeCents; a.disk += row.diskCents; a.running += row.runningSeconds; a.vcpu += row.vcpuSeconds; a.diskGiB += row.diskGiBSeconds;
    byAccount.set(row.accountId, a);
    const c = byCloud.get(row.cloudId) ?? { running: 0, days: 0 };
    c.running += row.runningSeconds; c.days++;
    byCloud.set(row.cloudId, c);
  }
  const known = new Map(input.customers.map(customer => [customer.accountId, customer]));
  const ids = new Set([...input.customers.filter(customer => customer.mrr > 0).map(customer => customer.accountId), ...byAccount.keys()]);
  const customers = [...ids].map(accountId => {
    const customer = known.get(accountId), cost = byAccount.get(accountId);
    const mrr = customer?.mrr ?? 0, fee = Math.round(feeOf({ mrr, interval: customer?.interval ?? null }));
    const costCents = Math.round((cost?.compute ?? 0) + (cost?.disk ?? 0)), projectedCents = Math.round(((cost?.compute ?? 0) + (cost?.disk ?? 0)) / elapsed);
    return { accountId, email: customer?.email ?? null, plan: customer?.plan ?? "none", status: customer?.status ?? "none", mrr, feeCents: fee,
      computeCents: Math.round(cost?.compute ?? 0), diskCents: Math.round(cost?.disk ?? 0), costCents, projectedCents,
      awakeHours: Math.round((cost?.running ?? 0) / 360) / 10, egressGb: Math.round((cost?.egress ?? 0) / 1e8) / 10, egressState: input.egress?.get(accountId) ?? null, marginCents: mrr - fee - projectedCents, margin: pct(mrr - fee - projectedCents, mrr) };
  }).sort((a, b) => b.mrr - a.mrr || b.costCents - a.costCents);
  const sum = (pick: (row: typeof customers[number]) => number) => customers.reduce((total, row) => total + pick(row), 0);
  const mrr = sum(row => row.mrr), fees = sum(row => row.feeCents), projected = sum(row => row.projectedCents);
  const histogram = HOUR_BUCKETS.map(bucket => ({ label: bucket.label, clouds: 0 }));
  for (const cloud of byCloud.values()) {
    const hours = cloud.running / 3600 / Math.max(1, cloud.days);
    histogram[HOUR_BUCKETS.findIndex(bucket => hours >= bucket.min && hours < bucket.max)]!.clouds++;
  }
  return {
    month: dayKey(start).slice(0, 7), days: monthDays.size, elapsed: Math.round(elapsed * 1000) / 1000,
    totals: { mrr, feeCents: fees, computeCents: sum(row => row.computeCents), diskCents: sum(row => row.diskCents), costCents: sum(row => row.costCents), projectedCents: projected,
      marginCents: mrr - fees - projected, margin: pct(mrr - fees - projected, mrr), unbilledCents: sum(row => row.mrr > 0 ? 0 : row.costCents), clouds: byCloud.size },
    customers,
    worst: customers.filter(row => row.margin !== null).sort((a, b) => a.margin! - b.margin! || b.costCents - a.costCents).slice(0, input.worst ?? 5),
    awake: histogram,
    assumptions: { dodo: DODO_FEE, diskCentsPerGiBMonth: DISK_CENTS_PER_GIB_MONTH, diskUpperBound: true },
  };
}
export type MarginReport = ReturnType<typeof marginReport>;
