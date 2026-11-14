// per-account fair use over a utc month, the same curve as the link service (apps/link-service/src/fair-use.mjs): full
// speed up to 20 GB, then slower along a smooth curve (linear in the log of the rate) to 2 Mbit/s at 80 GB, and past
// that a chat-only rate (256 kbit/s) that still carries messages and approvals. a short burst at the current rate stays
// even when slowed, and small messages have an allowance of their own. pure functions, unit tested.

export const GB = 1_000_000_000;
const KiB = 1024, MiB = 1024 * 1024;
/** the per-account top rate, all its servers together (3 MiB/s, as the link service) */
export const CAP_BYTES_PER_S = 3 * MiB;
/** a month's bytes at full speed */
export const FULL_SPEED_BYTES = 20 * GB;
/** where the curve reaches FLOOR_BYTES_PER_S */
export const FLOOR_AT_BYTES = 80 * GB;
/** the end of the curve (2 Mbit/s) */
export const FLOOR_BYTES_PER_S = 250_000;
/** past FLOOR_AT_BYTES: chat, approvals and a slow page (256 kbit/s) */
export const CHAT_BYTES_PER_S = 32_000;
/** the burst is this many seconds of the current rate, at least BURST_MIN */
export const BURST_SECONDS = 45;
export const BURST_MIN = 2 * MiB;
/** a message this small (a chat message, an approval) takes the small allowance when the rate's bucket is spent */
export const SMALL_MESSAGE_BYTES = 16 * KiB;
export const SMALL_BYTES_PER_S = 64 * KiB;
export const SMALL_BURST_BYTES = MiB;
/** a tunnel counts toward its account's share while it moved bytes this recently */
export const ACTIVE_MS = 10_000;

/** the account's rate for the month so far, in bytes per second */
export function fairRate(monthBytes, { cap = CAP_BYTES_PER_S, full = FULL_SPEED_BYTES, floorAt = FLOOR_AT_BYTES, floor = FLOOR_BYTES_PER_S, chat = CHAT_BYTES_PER_S } = {}) {
  const lowest = Math.min(cap, floor);
  const end = Math.max(full + 1, floorAt);
  if (!(monthBytes > full)) return cap;
  if (monthBytes >= end) return Math.min(lowest, chat);
  const f = (monthBytes - full) / (end - full);
  return Math.max(lowest, Math.round(Math.exp(Math.log(cap) * (1 - f) + Math.log(lowest) * f)));
}

export const burstFor = (rate, seconds = BURST_SECONDS) => Math.max(BURST_MIN, Math.floor(rate * seconds));

/** "2026-11" for a time, utc: the month a byte counts toward */
export const monthOf = (t) => new Date(t).toISOString().slice(0, 7);

/**
 * a token bucket that may go into debt by one message: a message goes now while the bucket is not negative, so one
 * larger than the burst never waits forever. `take` answers 0 (sent, charged) or the ms to wait before asking again.
 * `small`: a message up to SMALL_MESSAGE_BYTES the spent bucket cannot take goes from an allowance of its own.
 */
export function createBucket({ rate = CAP_BYTES_PER_S, burst = burstFor(rate), small: smallOn = false, now = () => Date.now() } = {}) {
  let tokens = burst, small = smallOn ? SMALL_BURST_BYTES : 0, at = now();
  const refill = (t) => {
    const dt = Math.max(0, t - at);
    tokens = Math.min(burst, tokens + (dt * rate) / 1000);
    if (smallOn) small = Math.min(SMALL_BURST_BYTES, small + (dt * SMALL_BYTES_PER_S) / 1000);
    at = t;
  };
  return {
    take(size, t = now()) {
      refill(t);
      if (tokens >= 0) { tokens -= size; return 0; }
      // a slowed account's chat still goes at once
      if (smallOn && size <= SMALL_MESSAGE_BYTES && small >= size) { small -= size; return 0; }
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
  /** the burst a tunnel may send at once; null: accountBurstSeconds of its rate */
  burstBytes: null,
  /** linked servers one account may have on the relay at once */
  tunnelsPerAccount: 10,
  /** every tunnel's bytes together; each active tunnel gets an equal share of it */
  globalCeilingBytesPerSec: null,
  /** linked servers on the relay at once; past it a new one is told the relay is busy */
  maxTunnels: 5000,
  /** the account's full speed, how many bytes a month it keeps it, and where the curve ends */
  accountBytesPerSec: CAP_BYTES_PER_S,
  accountFullSpeedBytes: FULL_SPEED_BYTES,
  accountFloorAtBytes: FLOOR_AT_BYTES,
  /** the end of the curve, and the chat-only rate past it */
  floorBytesPerSec: FLOOR_BYTES_PER_S,
  chatBytesPerSec: CHAT_BYTES_PER_S,
  /** seconds of the current rate a tunnel may burst, slowed or not */
  accountBurstSeconds: BURST_SECONDS,
  /** no new linked server gets on; the ones already on stay */
  paused: false,
});
/** limits that are gone (the per tunnel day cap, replaced by the monthly account curve): skipped when stored or sent */
export const RETIRED_LIMITS = Object.freeze(new Set(["perTunnelDailyBytes"]));

const fresh = (month) => ({ month, bytes: 0, bytesOut: 0, bytesIn: 0, awakeMs: 0, messages: 0, tunnels: {}, slowedAt: null, day: null, dayTunnels: {} });

/** the rate one tunnel may use now: its account's tier shared by its active tunnels, then the owner's caps */
export function tunnelAnswer(state, { t: _t }, { limits = DEFAULT_LIMITS, globalShare = null } = {}) {
  const active = Math.max(1, Object.keys(state.tunnels).length);
  const accountRate = fairRate(state.bytes, { cap: limits.accountBytesPerSec, full: limits.accountFullSpeedBytes, floorAt: limits.accountFloorAtBytes ?? FLOOR_AT_BYTES, floor: limits.floorBytesPerSec, chat: limits.chatBytesPerSec ?? CHAT_BYTES_PER_S });
  let rate = Math.floor(accountRate / active);
  if (limits.perTunnelBytesPerSec) rate = Math.min(rate, limits.perTunnelBytesPerSec);
  if (globalShare) rate = Math.min(rate, globalShare);
  rate = Math.max(1, rate);
  return { rate, burst: limits.burstBytes ?? burstFor(rate, limits.accountBurstSeconds ?? BURST_SECONDS), accountRate, monthBytes: state.bytes, active };
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
