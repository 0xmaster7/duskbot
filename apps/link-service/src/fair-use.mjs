// per-account fair use of the relay over a utc month, summed across nodes: full speed up to accountFullSpeedBytes, then
// slower along a smooth curve (linear in the log of the rate) down to floorBytesPerSec at accountFloorAtBytes, and past
// that a chat-only rate (chatBytesPerSec) that still carries messages and approvals. a short burst at the account's rate
// stays even when slowed, and small posts (a chat message, an approval) have a small allowance of their own, so a slowed
// account still feels instant for what matters. the relay should rarely carry traffic at all: every server has a direct
// way and a cloudflare tunnel before it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KiB = 1024, MiB = 1024 ** 2, GB = 1000 ** 3;

/** the defaults; the owner changes them on the ops page (relay-limits.json), each node the same way */
export const FAIR_USE_DEFAULTS = Object.freeze({
  /** an account's top rate on the relay, all its servers together */
  accountBytesPerSec: 3 * MiB,
  /** a month's bytes at full speed */
  accountFullSpeedBytes: 20 * GB,
  /** where the curve reaches floorBytesPerSec */
  accountFloorAtBytes: 80 * GB,
  /** the end of the curve (2 mbit/s) */
  floorBytesPerSec: 250_000,
  /** past accountFloorAtBytes: enough for chat, approvals and a slow page (256 kbit/s) */
  chatBytesPerSec: 32_000,
  /** seconds of the account's full rate it may burst even while slowed */
  accountBurstSeconds: 45,
});
export const FAIR_USE_RANGES = Object.freeze({
  accountBytesPerSec: [64 * KiB, 1024 * MiB],
  accountFullSpeedBytes: [0, 1e15],
  accountFloorAtBytes: [1, 1e15],
  floorBytesPerSec: [8 * KiB, 1024 * MiB],
  chatBytesPerSec: [4 * KiB, 1024 * MiB],
  accountBurstSeconds: [0, 600],
});
/** a post this small (a chat message, an approval, a page's json) takes the small allowance when the account's is spent */
export const SMALL_POST_BYTES = 16 * KiB;
export const SMALL_BYTES_PER_SEC = 64 * KiB;
export const SMALL_BURST_BYTES = MiB;

/** the account's rate for the month so far, bytes a second */
export function fairRate(monthBytes, limits = FAIR_USE_DEFAULTS) {
  const full = limits.accountFullSpeedBytes ?? FAIR_USE_DEFAULTS.accountFullSpeedBytes;
  const floorAt = Math.max(full + 1, limits.accountFloorAtBytes ?? FAIR_USE_DEFAULTS.accountFloorAtBytes);
  const top = limits.accountBytesPerSec ?? FAIR_USE_DEFAULTS.accountBytesPerSec;
  const floor = Math.min(top, limits.floorBytesPerSec ?? FAIR_USE_DEFAULTS.floorBytesPerSec);
  if (!(monthBytes > full)) return top;
  if (monthBytes >= floorAt) return Math.min(floor, limits.chatBytesPerSec ?? FAIR_USE_DEFAULTS.chatBytesPerSec);
  const f = (monthBytes - full) / (floorAt - full);
  return Math.max(floor, Math.round(Math.exp(Math.log(top) * (1 - f) + Math.log(floor) * f)));
}

/** "2026-11" for a time, utc */
export const monthOf = (t) => new Date(t).toISOString().slice(0, 7);

/**
 * every account's relay bytes this month: this node's own (kept in account-usage.json) and what each peer node said it
 * carried for it (from the directory's sync), so the curve follows an account across nodes
 */
export function createAccountUsage({ dir = null, now = Date.now, log = () => {} } = {}) {
  const file = dir ? join(dir, "account-usage.json") : null;
  let saved = null;
  try { saved = file ? JSON.parse(readFileSync(file, "utf8")) : null; } catch {}
  let month = saved?.month === monthOf(now()) ? saved.month : monthOf(now());
  let own = new Map(saved?.month === month ? Object.entries(saved.own ?? {}) : []);
  const peers = new Map();
  let dirty = false, savedAt = 0;
  function roll() {
    const current = monthOf(now());
    if (current === month) return;
    month = current; own = new Map(); peers.clear(); dirty = true;
  }
  function persist(force = false) {
    if (!file || !dirty || (!force && now() - savedAt < 30_000)) return;
    dirty = false; savedAt = now();
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, month, own: Object.fromEntries(own) }), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (error) { log(`link: could not save account usage (${error?.message ?? error})`); }
  }
  const total = (key) => { roll(); let sum = own.get(key) ?? 0; for (const map of peers.values()) sum += map.get(key) ?? 0; return sum; };
  return {
    add(key, bytes) { if (!bytes) return; roll(); own.set(key, (own.get(key) ?? 0) + bytes); dirty = true; persist(); },
    total,
    /** this node's own numbers, for a peer (the largest `max`) */
    own(max = 5000) { roll(); return { month, accounts: Object.fromEntries([...own].sort((a, b) => b[1] - a[1]).slice(0, max)) }; },
    /** a peer's numbers for this month (anything else is ignored) */
    merge(peer, value) {
      roll();
      if (value?.month !== month || !value.accounts || typeof value.accounts !== "object") return;
      const map = new Map();
      for (const [key, bytes] of Object.entries(value.accounts).slice(0, 20_000)) if (typeof key === "string" && key.length <= 80 && Number.isFinite(bytes) && bytes >= 0) map.set(key, bytes);
      peers.set(peer, map);
    },
    /** the heaviest accounts this month across every node, for the ops page */
    top(n = 20) {
      roll();
      const keys = new Set(own.keys());
      for (const map of peers.values()) for (const key of map.keys()) keys.add(key);
      return [...keys].map((key) => ({ key, bytes: total(key), here: own.get(key) ?? 0 })).sort((a, b) => b.bytes - a.bytes).slice(0, n);
    },
    month: () => { roll(); return month; },
    save: () => persist(true),
  };
}

/** a token bucket in bytes: `wait(size)` is the ms before `size` fits (0: now), `take(size)` spends it */
export function bucket(rate, burst, t) {
  return { rate, burst, tokens: burst, at: t };
}
export function refillBucket(b, t, rate, burst) {
  b.tokens = Math.min(burst, b.tokens + (Math.max(0, t - b.at) * rate) / 1000);
  b.at = t; b.rate = rate; b.burst = burst;
  return b;
}
