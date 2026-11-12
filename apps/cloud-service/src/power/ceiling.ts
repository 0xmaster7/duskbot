// The hard monthly ceiling on what one home may cost, for any provider. A home's book for a calendar month (UTC) counts
// everything it spends: compute while its machine may be running, every start at the worst price it could have had
// until the pool ledger proves less, backup storage, any second machine (a retired disk's keep-alive), and the home's own
// disk while its machine exists. The ceiling is the month's always-on compute times CEILING_FACTOR, prorated by the hours
// spent at each size, plus that disk: the plan sells its disk, so it is in both and only the rest is bounded by the factor. docs/power.md has the
// proof that spend never passes it; the rules that keep it are in rails.ts.
import { HOUR, type ProviderCostProfile } from "./cost.ts";

/** small's ceiling is $14.00 against $13.14 always-on (730 h at $0.018); every size scales by the same factor */
export const CEILING_FACTOR = 1400 / 1314;
/** a month is priced as at most this many hours: a 31-day month gets no more ceiling than a 30.4-day one */
export const CEILING_HOURS = 730;

export interface CeilingSettings {
  factor: number;
  hours: number;
  /** backup storage, cents per GB (10^9 bytes) per month */
  storageCentsPerGbMonth: number;
}
export const DEFAULT_CEILING: CeilingSettings = { factor: CEILING_FACTOR, hours: CEILING_HOURS, storageCentsPerGbMonth: 1.5 };

export interface Month { key: string; start: number; end: number; hours: number }
export function monthOf(t: number): Month {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = Date.UTC(y, m, 1), end = Date.UTC(y, m + 1, 1);
  return { key: `${y}-${String(m + 1).padStart(2, "0")}`, start, end, hours: (end - start) / HOUR };
}
/** the ceiling per hour of compute in a month this long, as a multiple of the compute */
export const ceilingFactor = (monthHours: number, s: CeilingSettings = DEFAULT_CEILING) => s.factor * Math.min(1, s.hours / monthHours);
/** a size's ceiling for a whole month at that size */
export const monthlyCeilingCents = (centsPerHour: number, monthHours: number = CEILING_HOURS, s: CeilingSettings = DEFAULT_CEILING) =>
  centsPerHour * monthHours * ceilingFactor(monthHours, s);

/** the most one start can cost: one short of the hard cap in every window (Infinity past it means refused, not dearer) */
export function worstStartCents(profile: ProviderCostProfile): number {
  const top = (n: number) => Math.max(0, Math.floor(n) - 1), cap = profile.hardCap;
  const prices = [{ minute: top(cap.minute), hour: top(cap.hour), day: top(cap.day) }, { minute: top(cap.minute), hour: 0, day: 0 }, { minute: 0, hour: top(cap.hour), day: 0 }, { minute: 0, hour: 0, day: top(cap.day) }]
    .map(used => profile.startCents(used)).filter(Number.isFinite);
  if (!prices.length) throw new Error("The provider's cost profile has no finite worst start price.");
  return Math.max(0, ...prices);
}

/** one home's spend in one month; every amount in cents, every time in ms */
export interface SpendBook {
  month: string; start: number; end: number; hours: number;
  /** accrued up to here */
  at: number;
  /** a machine of this home may be running (billed): set before any start is asked for, cleared only once one is seen stopped or gone */
  up: boolean;
  rate: number;
  /** the cheapest size's compute price: the future ceiling is only counted at its margin, so a downsize can never strand spend */
  floor: number;
  bytes: number;
  /** the home's own disk, cents per hour while its machine exists (0 once it is deleted) */
  disk: number;
  /** the ceiling accrued for [start, at) */
  ceilingCents: number;
  computeCents: number; startCents: number; storageCents: number; extraCents: number; diskCents: number;
  /** the next start was paid for by the stop before it (ours, not the provider's) */
  prepaid: boolean;
  /** starts this month nobody paid for with a stop: failures, retries, provider stops, rebuilds */
  unplanned: number;
  starts: number;
  /** whether the last start was paid for by a stop (what a voided start gives back) */
  lastPlanned: boolean;
}

export type SpendEvent =
  | { e: "open"; rate: number; floor: number; up: boolean; bytes: number; prepaid: boolean; /** spend before `t` this month is unknown: priced as always-on */ before: boolean; disk?: number }
  | { e: "start"; kind: string; cents: number }
  /** the start's price once known: `cents` back; `void`: it never happened (the provider refused it) */
  | { e: "settle"; cents: number; void?: boolean }
  | { e: "up" } | { e: "down" }
  | { e: "stop" }
  | { e: "rate"; rate: number }
  | { e: "bytes"; bytes: number }
  | { e: "disk"; rate: number }
  | { e: "extra"; cents: number; why: string };

export const spentCents = (b: SpendBook) => b.computeCents + b.startCents + b.storageCents + b.extraCents + b.diskCents;
export const storageRate = (b: Pick<SpendBook, "bytes" | "hours">, s: CeilingSettings = DEFAULT_CEILING) => b.bytes / 1e9 * s.storageCentsPerGbMonth / b.hours;

export function openBook(at: number, open: Extract<SpendEvent, { e: "open" }>, s: CeilingSettings = DEFAULT_CEILING): SpendBook {
  const m = monthOf(at), f = ceilingFactor(m.hours, s), before = (at - m.start) / HOUR;
  const b: SpendBook = { month: m.key, start: m.start, end: m.end, hours: m.hours, at, up: open.up, rate: open.rate, floor: Math.min(open.floor, open.rate), bytes: Math.max(0, open.bytes),
    disk: Math.max(0, open.disk ?? 0), ceilingCents: open.rate * f * before, computeCents: 0, startCents: 0, storageCents: 0, extraCents: 0, diskCents: 0, prepaid: open.prepaid, unplanned: 0, starts: 0, lastPlanned: false };
  if (open.before) { b.computeCents = open.rate * before; b.storageCents = storageRate(b, s) * before; b.diskCents = b.disk * before; b.ceilingCents += b.disk * before; }
  return b;
}

/** accrues the book up to `to`; a month that ends on the way is closed (returned) and the book carries into the next */
export function advanceBook(b: SpendBook, to: number, s: CeilingSettings = DEFAULT_CEILING): SpendBook[] {
  const closed: SpendBook[] = [];
  while (to > b.at) {
    const until = Math.min(to, b.end), h = (until - b.at) / HOUR;
    b.ceilingCents += (b.rate * ceilingFactor(b.hours, s) + b.disk) * h;
    if (b.up) b.computeCents += b.rate * h;
    b.diskCents += b.disk * h;
    b.storageCents += storageRate(b, s) * h;
    b.at = until;
    if (until < b.end) break;
    closed.push({ ...b });
    const m = monthOf(b.end);
    Object.assign(b, { month: m.key, start: m.start, end: m.end, hours: m.hours, at: m.start, ceilingCents: 0, computeCents: 0, startCents: 0, storageCents: 0, extraCents: 0, diskCents: 0, unplanned: 0, starts: 0 });
  }
  return closed;
}

/** what the book can still spend: the ceiling (past at the real sizes, the rest of the month at the cheapest size's margin)
 *  minus what was spent and what staying up all month and keeping today's backups would still cost */
export function slackCents(b: SpendBook, s: CeilingSettings = DEFAULT_CEILING): number {
  const rest = Math.max(0, (b.end - b.at) / HOUR);
  return b.ceilingCents - spentCents(b) + rest * ((ceilingFactor(b.hours, s) - 1) * b.floor - storageRate(b, s));
}
/** what holding `bytes` of backups for the rest of the month adds to the book's commitment */
export function storageCommitCents(b: SpendBook, bytes: number, s: CeilingSettings = DEFAULT_CEILING): number {
  return Math.max(0, (b.end - b.at) / HOUR) * storageRate({ bytes, hours: b.hours }, s);
}

/** applies one event at the book's time (advance it first) */
export function applySpend(b: SpendBook, ev: SpendEvent): void {
  switch (ev.e) {
    case "start":
      b.startCents += ev.cents; b.starts++; b.up = true; b.lastPlanned = b.prepaid;
      if (b.prepaid) b.prepaid = false; else b.unplanned++;
      break;
    case "settle":
      b.startCents -= Math.max(0, ev.cents);
      if (ev.void) { b.starts = Math.max(0, b.starts - 1); if (b.lastPlanned) b.prepaid = true; else b.unplanned = Math.max(0, b.unplanned - 1); b.lastPlanned = false; }
      break;
    case "up": b.up = true; break;
    case "down": b.up = false; break;
    case "stop": b.prepaid = true; break;
    case "rate": b.rate = ev.rate; b.floor = Math.min(b.floor, ev.rate); break;
    case "bytes": b.bytes = Math.max(0, ev.bytes); break;
    case "disk": b.disk = Math.max(0, ev.rate); break;
    case "extra": b.extraCents += ev.cents; break;
    case "open": break;
  }
}

/** what the rails read: plain numbers, no provider in them */
export interface SpendView {
  slackCents: number;
  /** the worst price of one start */
  worstStartCents: number;
  /** starts the book keeps in reserve for what we do not choose (failed starts, the breaker's probes, a rebuild) */
  reserveStarts: number;
  /** starts this month we did not choose */
  unplanned: number;
  /** how fast the slack grows now, cents per hour (a stopped machine's compute) */
  gainCentsPerHour: number;
}
export function spendView(b: SpendBook, worst: number, reserveStarts: number, s: CeilingSettings = DEFAULT_CEILING): SpendView {
  const f = ceilingFactor(b.hours, s);
  return { slackCents: slackCents(b, s), worstStartCents: worst, reserveStarts, unplanned: b.unplanned,
    gainCentsPerHour: b.up ? (f - 1) * (b.rate - b.floor) : b.rate * f - (f - 1) * b.floor };
}
