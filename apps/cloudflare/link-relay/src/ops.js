// the owner's relay controls (GET /ops/relay/stats, PUT /ops/relay/limits), the same shape the link service answers on
// the contabo box. pure functions, unit tested; the ops Durable Object (accounts.js) holds the state.
import { DEFAULT_LIMITS, RETIRED_LIMITS } from "./fair-use.js";

/** a linked server's standing socket hibernates, so the tunnel's object checks in this often while it is connected */
export const HEARTBEAT_MS = 5 * 60_000;
/** a tunnel that has not checked in for this long is no longer counted as on the relay */
export const LEASE_MS = 12 * 60_000;
/** an account's live speed counts while it rolled up this recently */
export const LIVE_MS = 25_000;
/** the per-account roll-up into the ops object while bytes move */
export const ROLLUP_MS = 10_000;
/** utc days of per-account traffic kept for "top today" */
export const KEEP_DAYS = 3;

/**
 * Workers Paid, 2026-11: Durable Object duration $12.50 per million GB-s billed at 128 MB while awake, and incoming
 * websocket messages billed 20 to a request at $0.15 per million requests. in cents.
 */
export const DO_PRICE = Object.freeze({ centsPerAwakeSecond: 0.125 * 12.5e-6 * 100, centsPerMessage: (0.15e-6 * 100) / 20 });

const RATE = { min: 8_000, max: 10_000_000_000 };
const LIMIT_RULES = {
  perTunnelBytesPerSec: { ...RATE, nullable: true },
  burstBytes: { min: 64 * 1024, max: 10_000_000_000, nullable: true },
  tunnelsPerAccount: { min: 0, max: 100_000, nullable: true },
  globalCeilingBytesPerSec: { ...RATE, nullable: true },
  maxTunnels: { min: 0, max: 10_000_000, nullable: true },
  accountBytesPerSec: { ...RATE, nullable: false },
  accountFullSpeedBytes: { min: 0, max: 1e15, nullable: false },
  accountFloorAtBytes: { min: 1, max: 1e15, nullable: false },
  floorBytesPerSec: { ...RATE, nullable: false },
  chatBytesPerSec: { min: 4_000, max: 10_000_000_000, nullable: false },
  accountBurstSeconds: { min: 0, max: 600, nullable: false },
};

/** stored limits over the defaults, keeping only known keys */
export function normalizeLimits(stored) {
  const out = { ...DEFAULT_LIMITS };
  if (stored && typeof stored === "object") {
    for (const key of Object.keys(DEFAULT_LIMITS)) if (key in stored) out[key] = stored[key];
  }
  return out;
}

/** a PUT body: only known keys, each a whole number in range (or null where it can be off), `paused` a boolean */
export function applyLimits(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "send an object of limits" };
  const keys = Object.keys(patch);
  if (!keys.length) return { ok: false, error: "send at least one limit" };
  const next = { ...current };
  for (const key of keys) {
    const value = patch[key];
    if (key === "paused") {
      if (typeof value !== "boolean") return { ok: false, error: "paused must be true or false" };
      next.paused = value;
      continue;
    }
    if (RETIRED_LIMITS.has(key)) continue;
    const rule = LIMIT_RULES[key];
    if (!rule) return { ok: false, error: `unknown limit ${key.slice(0, 40)}` };
    if (value === null && rule.nullable) { next[key] = null; continue; }
    if (!Number.isSafeInteger(value) || value < rule.min || value > rule.max) return { ok: false, error: `${key} must be a whole number from ${rule.min} to ${rule.max}${rule.nullable ? ", or null for off" : ""}` };
    next[key] = value;
  }
  if (next.floorBytesPerSec > next.accountBytesPerSec) return { ok: false, error: "floorBytesPerSec can't be above accountBytesPerSec" };
  if (next.accountFloorAtBytes <= next.accountFullSpeedBytes) return { ok: false, error: "accountFloorAtBytes must be above accountFullSpeedBytes" };
  return { ok: true, limits: next };
}

/**
 * may a linked server get on the relay? one already on (a reconnect, a deploy) always may.
 * @returns {null | { code: string, error: string }}
 */
export function admitTunnel(limits, { known, total, forAccount }) {
  if (known) return null;
  if (limits.paused) return { code: "relay_busy", error: "the relay is not taking new links right now" };
  if (limits.maxTunnels !== null && total >= limits.maxTunnels) return { code: "relay_busy", error: "the relay is busy" };
  if (limits.tunnelsPerAccount !== null && forAccount >= limits.tunnelsPerAccount) return { code: "account_tunnels", error: "this account has as many servers on the relay as it may" };
  return null;
}

/** each active tunnel's equal part of the global ceiling, or null with no ceiling */
export function globalShareOf(limits, activeTunnels) {
  return limits.globalCeilingBytesPerSec ? Math.max(1, Math.floor(limits.globalCeilingBytesPerSec / Math.max(1, activeTunnels))) : null;
}

/** what the month cost so far in Durable Object duration and messages, in cents */
export const costCents = ({ awakeMs, messages }) => (awakeMs / 1000) * DO_PRICE.centsPerAwakeSecond + messages * DO_PRICE.centsPerMessage;

/** the share of the utc month gone at `t`, never zero */
export function monthElapsed(t) {
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return Math.max(1 / 1440, (t - start) / (end - start));
}

/** a month's figure so far, at this pace to the month's end */
export const projected = (value, t) => Math.round(value / monthElapsed(t));

/** the busy answer: a tunnel at the cap, or the owner paused new ones */
export const isBusy = (limits, tunnels) => limits.paused || (limits.maxTunnels !== null && tunnels >= limits.maxTunnels);
