// per-account fair use: full speed (25 Mbit/s with a burst) up to 50 GB a month, then the rate halves for every
// further 50 GB down to a floor, so a heavy month gets slower but is never cut off. pure functions, unit tested.

export const GB = 1_000_000_000;
/** the per-account cap, in bytes per second (25 Mbit/s) */
export const CAP_BYTES_PER_S = 25_000_000 / 8;
/** a month's bytes at full speed */
export const FULL_SPEED_BYTES = 50 * GB;
/** past full speed, every this many more bytes halve the rate */
export const HALVING_BYTES = 50 * GB;
/** the slowest it ever gets (2 Mbit/s) */
export const FLOOR_BYTES_PER_S = 2_000_000 / 8;
/** the burst is this many seconds of the current rate, at least BURST_MIN */
export const BURST_SECONDS = 8;
export const BURST_MIN = 2 * 1024 * 1024;
/** a tunnel counts toward its account's share while it moved bytes this recently */
export const ACTIVE_MS = 10_000;

/** the account's rate for the month so far, in bytes per second */
export function tierRate(monthBytes, { cap = CAP_BYTES_PER_S, full = FULL_SPEED_BYTES, halving = HALVING_BYTES, floor = FLOOR_BYTES_PER_S } = {}) {
  if (!(monthBytes > full)) return cap;
  return Math.max(floor, Math.floor(cap * 2 ** (-(monthBytes - full) / halving)));
}

export const burstFor = (rate) => Math.max(BURST_MIN, Math.floor(rate * BURST_SECONDS));

/** "2026-11" for a time, utc: the month a byte counts toward */
export const monthOf = (t) => new Date(t).toISOString().slice(0, 7);

/**
 * a token bucket that may go into debt by one message: a message goes now while the bucket is not negative, so one
 * larger than the burst never waits forever. `take` answers 0 (sent, charged) or the ms to wait before asking again.
 */
export function createBucket({ rate = CAP_BYTES_PER_S, burst = burstFor(rate), now = () => Date.now() } = {}) {
  let tokens = burst, at = now();
  const refill = (t) => { tokens = Math.min(burst, tokens + (Math.max(0, t - at) * rate) / 1000); at = t; };
  return {
    take(size, t = now()) {
      refill(t);
      if (tokens >= 0) { tokens -= size; return 0; }
      return Math.max(1, Math.ceil((-tokens * 1000) / rate));
    },
    set(nextRate, nextBurst = burstFor(nextRate), t = now()) {
      refill(t);
      rate = Math.max(1, nextRate);
      burst = Math.max(1, nextBurst);
      tokens = Math.min(tokens, burst);
    },
    get rate() { return rate; },
    get burst() { return burst; },
    get tokens() { refill(now()); return tokens; },
  };
}

/** "2026-11-13" for a time, utc: the day a byte counts toward */
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * the limits the owner can change from the admin ops page (PUT /ops/relay/limits), with their defaults. null turns one
 * off. rates are bytes per second, sizes bytes.
 */
export const DEFAULT_LIMITS = Object.freeze({
  /** one tunnel's top speed; its account's share applies too */
  perTunnelBytesPerSec: CAP_BYTES_PER_S,
  /** the burst a tunnel may send at once; null: BURST_SECONDS of its rate */
  burstBytes: null,
  /** past this many bytes in a utc day a tunnel drops to the floor rate (never cut off) */
  perTunnelDailyBytes: null,
  /** linked servers one account may have on the relay at once */
  tunnelsPerAccount: 10,
  /** every tunnel's bytes together; each active tunnel gets an equal share of it */
  globalCeilingBytesPerSec: null,
  /** linked servers on the relay at once; past it a new one is told the relay is busy */
  maxTunnels: 5000,
  /** the account's full speed and how many bytes a month it keeps it */
  accountBytesPerSec: CAP_BYTES_PER_S,
  accountFullSpeedBytes: FULL_SPEED_BYTES,
  /** the slowest the halving goes */
  floorBytesPerSec: FLOOR_BYTES_PER_S,
  /** no new linked server gets on; the ones already on stay */
  paused: false,
});

const fresh = (month) => ({ month, bytes: 0, bytesOut: 0, bytesIn: 0, awakeMs: 0, messages: 0, tunnels: {}, slowedAt: null, day: null, dayTunnels: {} });

/** the rate one tunnel may use now: its account's tier shared by its active tunnels, then the owner's caps */
export function tunnelAnswer(state, { tunnel, t }, { limits = DEFAULT_LIMITS, globalShare = null } = {}) {
  const active = Math.max(1, Object.keys(state.tunnels).length);
  const accountRate = tierRate(state.bytes, { cap: limits.accountBytesPerSec, full: limits.accountFullSpeedBytes, floor: limits.floorBytesPerSec });
  let rate = Math.floor(accountRate / active);
  if (limits.perTunnelBytesPerSec) rate = Math.min(rate, limits.perTunnelBytesPerSec);
  if (globalShare) rate = Math.min(rate, globalShare);
  const dayBytes = state.day === dayOf(t) ? state.dayTunnels[tunnel] ?? 0 : 0;
  if (limits.perTunnelDailyBytes && dayBytes > limits.perTunnelDailyBytes) rate = Math.min(rate, limits.floorBytesPerSec);
  rate = Math.max(1, rate);
  return { rate, burst: limits.burstBytes ?? burstFor(rate), accountRate, monthBytes: state.bytes, active };
}

/**
 * one account's month: bytes so far and which tunnels moved bytes lately. `report` adds a tunnel's bytes and answers the
 * rate that tunnel may use now: the account's rate shared by its active tunnels.
 */
export function accountReport(state, { tunnel, bytes, bytesOut = 0, bytesIn = 0, awakeMs = 0, messages = 0, t }, policy = {}) {
  const limits = policy.limits ?? DEFAULT_LIMITS;
  const month = monthOf(t), day = dayOf(t);
  const next = state && state.month === month ? { ...fresh(month), ...state, tunnels: { ...state.tunnels }, dayTunnels: { ...state.dayTunnels } } : fresh(month);
  next.bytes += Math.max(0, bytes);
  next.bytesOut += Math.max(0, bytesOut);
  next.bytesIn += Math.max(0, bytesIn);
  next.awakeMs += Math.max(0, awakeMs);
  next.messages += Math.max(0, messages);
  if (next.day !== day) { next.day = day; next.dayTunnels = {}; }
  next.dayTunnels[tunnel] = (next.dayTunnels[tunnel] ?? 0) + Math.max(0, bytes);
  next.tunnels[tunnel] = t;
  for (const [id, seen] of Object.entries(next.tunnels)) if (t - seen > ACTIVE_MS) delete next.tunnels[id];
  const answer = tunnelAnswer(next, { tunnel, t }, { limits, globalShare: policy.globalShare ?? null });
  if (answer.accountRate < limits.accountBytesPerSec && !next.slowedAt) next.slowedAt = t;
  return { state: next, answer };
}
