// When the owner (or a connector acting for them) will next need the home, learned from that home's own history. Two
// parts, both cheap and deterministic: a return within the same session (the gaps between their events, under 90
// minutes), and a new session (how often one began in each hour of the day, weekdays and weekends apart). Counts decay
// with a half-life, so a changed routine is learned in days; a new home starts from a flat prior.
import { DAY, HOUR, MINUTE } from "./cost.ts";

/** a gap this long or longer ends a session; the next event starts a new one */
export const SESSION_MS = 90 * MINUTE;
/** gap bins in minutes; events closer than the first edge are one burst */
export const GAP_EDGES = [1, 2, 3, 5, 8, 12, 17, 25, 35, 50, 70, 90] as const;
/** the offsets (minutes from now) a prediction is given at */
export const GRID_MIN = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360, 480, 600, 720, 960, 1200, 1440] as const;
export const GRID_MS: readonly number[] = GRID_MIN.map(m => m * MINUTE);

export interface ActivityStats {
  v: 1;
  /** when this home was first observed: the exposure the hourly counts are measured against */
  since: number;
  /** the time the decayed counts are referenced to */
  at: number;
  /** new sessions per UTC hour: weekdays 0..23, weekends 24..47 */
  starts: number[];
  /** gaps within a session per GAP_EDGES bin, and sessions that ended */
  gaps: number[];
  ends: number;
  lastAt: number | null;
  /** what the events were: a person, or a connector (Slack, a webhook) */
  human: number;
  connector: number;
}

export interface PredictorParams {
  /** counts halve over this long */
  halfLifeMs: number;
  /** the flat prior: sessions a day, worth this many days of evidence */
  priorSessionsPerDay: number;
  priorDays: number;
  /** the prior for returns within a session, worth this many sessions */
  priorSessions: number;
}
export const DEFAULT_PREDICTOR: PredictorParams = { halfLifeMs: 14 * DAY, priorSessionsPerDay: 3, priorDays: 2, priorSessions: 3 };
/** the shape of the prior for gaps within a session (per GAP_EDGES bin), and of ending one; scaled by priorSessions */
const PRIOR_GAPS = [0.9, 0.6, 0.6, 0.45, 0.35, 0.3, 0.25, 0.2, 0.15, 0.12, 0.08];
const PRIOR_END = 1;

export function freshStats(now: number): ActivityStats {
  return { v: 1, since: now, at: now, starts: Array(48).fill(0), gaps: Array(GAP_EDGES.length - 1).fill(0), ends: 0, lastAt: null, human: 0, connector: 0 };
}

/** a stored record, checked: anything malformed starts over rather than misleading the policy */
export function validStats(value: unknown, now: number): ActivityStats {
  const s = value as ActivityStats | null | undefined;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!s || s.v !== 1 || !finite(s.since) || !finite(s.at) || !Array.isArray(s.starts) || s.starts.length !== 48 || !s.starts.every(finite)
    || !Array.isArray(s.gaps) || s.gaps.length !== GAP_EDGES.length - 1 || !s.gaps.every(finite) || !finite(s.ends) || !finite(s.human) || !finite(s.connector)
    || !(s.lastAt === null || finite(s.lastAt))) return freshStats(now);
  return s;
}

const weekend = (t: number) => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6; };
const hourBin = (t: number) => new Date(t).getUTCHours() + (weekend(t) ? 24 : 0);

function decay(s: ActivityStats, now: number, halfLifeMs: number) {
  if (now <= s.at) return;
  const f = 2 ** (-(now - s.at) / halfLifeMs);
  for (let i = 0; i < s.starts.length; i++) s.starts[i]! *= f;
  for (let i = 0; i < s.gaps.length; i++) s.gaps[i]! *= f;
  s.ends *= f; s.human *= f; s.connector *= f;
  s.at = now;
}

/** an event that needed the home: a person's send or click, or a connector event addressed to the bot. Events out of
 *  order (a skewed clock, a duplicate delivery) only ever move `lastAt` forward. */
export function observe(s: ActivityStats, at: number, kind: "user" | "connector", params: PredictorParams = DEFAULT_PREDICTOR): ActivityStats {
  decay(s, Math.max(at, s.at), params.halfLifeMs);
  if (s.lastAt !== null && at <= s.lastAt + GAP_EDGES[0] * MINUTE) { if (at > s.lastAt) s.lastAt = at; return s; }
  if (kind === "user") s.human++; else s.connector++;
  if (s.lastAt !== null && at - s.lastAt < SESSION_MS) {
    const gap = (at - s.lastAt) / MINUTE;
    let bin = 0;
    while (bin < s.gaps.length - 1 && gap >= GAP_EDGES[bin + 1]!) bin++;
    s.gaps[bin]!++;
  } else {
    if (s.lastAt !== null) s.ends++;
    s.starts[hourBin(at)]!++;
  }
  s.lastAt = at;
  return s;
}

/** decayed days of observation, split 5:2 between weekdays and weekends */
function exposureDays(s: ActivityStats, now: number, halfLifeMs: number): [number, number] {
  const age = Math.max(0, now - s.since), h = halfLifeMs / DAY;
  const days = (h / Math.LN2) * (1 - 2 ** (-age / halfLifeMs));
  return [days * 5 / 7, days * 2 / 7];
}

/** new sessions per hour at each UTC hour, weekdays then weekends, shrunk toward the prior (weekends toward weekdays) */
export function sessionRates(s: ActivityStats, now: number, params: PredictorParams = DEFAULT_PREDICTOR): number[] {
  const f = now > s.at ? 2 ** (-(now - s.at) / params.halfLifeMs) : 1;
  const [wd, we] = exposureDays(s, now, params.halfLifeMs), prior = params.priorSessionsPerDay / 24;
  const rates = Array<number>(48);
  for (let h = 0; h < 24; h++) {
    const weekday = (s.starts[h]! * f + params.priorDays * prior) / (wd + params.priorDays);
    rates[h] = weekday;
    rates[h + 24] = (s.starts[h + 24]! * f + weekday) / (we + 1);
  }
  return rates;
}

/** the share of events that came from connectors rather than a person */
export function connectorShare(s: ActivityStats): number {
  const total = s.human + s.connector;
  return total < 0.5 ? 0 : s.connector / total;
}

/** P(no event yet) at each GRID_MS offset from now, given the stats; `tail` is the chance of none within the grid */
export interface Prediction { survival: number[] }

export function predict(s: ActivityStats, now: number, params: PredictorParams = DEFAULT_PREDICTOR): Prediction {
  const f = now > s.at ? 2 ** (-(now - s.at) / params.halfLifeMs) : 1;
  const idle = s.lastAt === null ? Number.POSITIVE_INFINITY : Math.max(0, now - s.lastAt);
  // the mass of within-session gaps longer than x (each bin spread evenly), plus the sessions that ended
  const prior = params.priorSessions, priorTotal = PRIOR_GAPS.reduce((a, b) => a + b, 0) + PRIOR_END;
  const gaps = s.gaps.map((g, i) => g * f + prior * PRIOR_GAPS[i]! / priorTotal), ends = s.ends * f + prior * PRIOR_END / priorTotal;
  const beyond = (xMs: number) => {
    const x = xMs / MINUTE;
    let m = ends;
    for (let i = 0; i < gaps.length; i++) {
      const lo = GAP_EDGES[i]!, hi = GAP_EDGES[i + 1]!;
      m += gaps[i]! * (x <= lo ? 1 : x >= hi ? 0 : (hi - x) / (hi - lo));
    }
    return m;
  };
  const base = Number.isFinite(idle) && idle < SESSION_MS ? beyond(idle) : 0;
  const rates = sessionRates(s, now, params);
  // a new session can only begin once the current one has ended (no event for SESSION_MS)
  const sessionFrom = Number.isFinite(idle) ? Math.max(now, s.lastAt! + SESSION_MS) : now;
  const survival: number[] = [];
  let lambda = 0, cursor = now;
  for (const offset of GRID_MS) {
    const until = now + offset;
    while (cursor < until) {
      const hourEnd = Math.min(until, Math.floor(cursor / HOUR) * HOUR + HOUR);
      const from = Math.max(cursor, sessionFrom);
      if (hourEnd > from) lambda += rates[hourBin(cursor)]! * (hourEnd - from) / HOUR;
      cursor = hourEnd;
    }
    const cont = base > 0 ? beyond(idle + offset) / base : 1;
    survival.push(Math.max(0, Math.min(1, cont * Math.exp(-lambda))));
  }
  for (let i = 1; i < survival.length; i++) survival[i] = Math.min(survival[i]!, survival[i - 1]!);
  return { survival };
}
