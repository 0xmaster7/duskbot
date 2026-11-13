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

/**
 * one account's month: bytes so far and which tunnels moved bytes lately. `report` adds a tunnel's bytes and answers the
 * rate that tunnel may use now: the account's rate shared by its active tunnels.
 */
export function accountReport(state, { tunnel, bytes, t }) {
  const month = monthOf(t);
  const next = state && state.month === month ? { ...state, tunnels: { ...state.tunnels } } : { month, bytes: 0, tunnels: {}, slowedAt: null };
  next.bytes += Math.max(0, bytes);
  next.tunnels[tunnel] = t;
  for (const [id, seen] of Object.entries(next.tunnels)) if (t - seen > ACTIVE_MS) delete next.tunnels[id];
  const active = Math.max(1, Object.keys(next.tunnels).length);
  const accountRate = tierRate(next.bytes);
  if (accountRate < CAP_BYTES_PER_S && !next.slowedAt) next.slowedAt = t;
  const rate = Math.max(1, Math.floor(accountRate / active));
  return { state: next, answer: { rate, burst: burstFor(rate), accountRate, monthBytes: next.bytes, active } };
}
