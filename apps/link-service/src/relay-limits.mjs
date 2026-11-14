// the relay's limits (changeable at runtime by the owner's ops page, kept in relay-limits.json) and its byte totals
// (per utc day and month, kept in relay-usage.json). every byte here is a frame's base64url text, the bytes on the wire.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FAIR_USE_DEFAULTS, FAIR_USE_RANGES } from "./fair-use.mjs";

const KiB = 1024, MiB = 1024 ** 2, GiB = 1024 ** 3;

/**
 * sized for the contabo box (upload measured 120 to 850 mbit/s; 32 tb a month, throttled to 100 mbit/s past a 10 day
 * average above it). the ceiling is ~88 mbit/s on the wire with http and tls, so even flat out all month the relay
 * stays under both rules. a tunnel's rate keeps a live screen near 20 fps; the daily total is 2.5x a heavy user's day.
 * the node is one process on one core, so its caps are what that core carries (measured 2026-11-14 on the contabo box,
 * docs/capacity.md: a server's agent reading here ~0.02% of the core, an open desktop on it ~0.01% more, 1 MB/s relayed
 * ~4%; oracle's cores do the same for about half). defaults are contabo's; each node keeps its own in relay-limits.json.
 * maxConnected and maxTunnels turn away only a tunnel new to the relay (one already in use is never cut off):
 * maxConnected: tunnels in use (any post in the last ACTIVE_MS). an open desktop app says hello every 15 s, so this is
 *   about "desktops open on a linked server".
 * maxTunnels: busy tunnels (BUSY_BYTES or more in the last ACTIVE_MS: a screen, a download), what the bandwidth carries.
 * maxServers: linked servers whose agent reads here (desktop open or not). never refused, only placement: past 90% new
 *   servers go to another node, at 100% servers move off when they reconnect.
 * paused: new tunnels get the busy answer, ones already in use keep going (the admin panel's "pause new tunnels" switch)
 */
export const DEFAULT_LIMITS = Object.freeze({
  perTunnelBytesPerSec: 3 * MiB,
  burstBytes: 24 * MiB,
  tunnelsPerAccount: 20,
  globalCeilingBytesPerSec: 10 * MiB,
  maxTunnels: 150,
  maxConnected: 1000,
  maxServers: 1500,
  ...FAIR_USE_DEFAULTS,
  paused: false,
});
export const LIMIT_RANGES = Object.freeze({
  perTunnelBytesPerSec: [64 * KiB, GiB],
  burstBytes: [MiB, 4 * GiB],
  tunnelsPerAccount: [1, 1000],
  globalCeilingBytesPerSec: [256 * KiB, 10 * GiB],
  maxTunnels: [1, 20000],
  maxConnected: [1, 50000],
  maxServers: [1, 100000],
  ...FAIR_USE_RANGES,
});
/** limits that are gone (the per tunnel day cap, replaced by the monthly account curve): a relay-limits.json or an ops
 * post from before may still carry them; they are skipped, never kept, and do not make the rest unreadable */
export const RETIRED_LIMITS = Object.freeze(new Set(["perTunnelDailyBytes"]));
/** contabo's monthly outgoing allowance */
export const MONTH_ALLOWANCE_BYTES = 32 * 1000 ** 4;
/** a tunnel that relayed a byte this recently is in use (maxConnected) */
export const ACTIVE_MS = 2 * 60_000;
/** one that relayed this much in the last ACTIVE_MS is busy (maxTunnels): more than a desktop's hellos or a typing screen */
export const BUSY_BYTES = 1024 * 1024;

/** a partial limits object, checked key by key; answers { limits } or { error } */
export function validateLimits(input, current = DEFAULT_LIMITS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "send a json object of limits" };
  const keys = Object.keys(input);
  if (!keys.length) return { error: "send at least one limit" };
  const next = { ...current };
  for (const key of keys) {
    const value = input[key];
    if (key === "paused") {
      if (typeof value !== "boolean") return { error: "paused must be true or false" };
      next.paused = value;
      continue;
    }
    if (RETIRED_LIMITS.has(key)) continue;
    const range = LIMIT_RANGES[key];
    if (!range) return { error: `unknown limit ${key.slice(0, 40)}` };
    if (!Number.isSafeInteger(value) || value < range[0] || value > range[1]) return { error: `${key} must be a whole number from ${range[0]} to ${range[1]}` };
    next[key] = value;
  }
  return { limits: next };
}

function readJsonFile(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (error) {
    if (error?.code !== "ENOENT") console.error(`link: ${file} unreadable, using defaults (${error?.message ?? error})`);
    return null;
  }
}
function writeJsonFile(dir, name, value) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, name), tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}

/** the saved limits over the defaults; a saved file that no longer validates is ignored, never half applied */
export function loadLimits(dir, base = DEFAULT_LIMITS) {
  const saved = dir ? readJsonFile(join(dir, "relay-limits.json")) : null;
  if (!saved) return { ...base };
  const { limits } = validateLimits(saved, base);
  return limits ?? { ...base };
}
export function saveLimits(dir, limits) {
  if (dir) writeJsonFile(dir, "relay-limits.json", limits);
}

/** bytes in (posted) and out (read) per utc day and month, and a ten second rate of each */
export function createRelayUsage({ dir = null, now = Date.now } = {}) {
  const saved = dir ? readJsonFile(join(dir, "relay-usage.json")) : null;
  const days = saved?.days && typeof saved.days === "object" ? saved.days : {};
  const months = saved?.months && typeof saved.months === "object" ? saved.months : {};
  // one slot per second for the last RATE_S seconds
  const RATE_S = 10;
  const ring = Array.from({ length: RATE_S + 1 }, () => ({ s: -1, in: 0, out: 0 }));
  let dirty = false;
  function add(kind, bytes) {
    if (!bytes) return;
    const t = now(), iso = new Date(t).toISOString(), day = iso.slice(0, 10), month = iso.slice(0, 7);
    (days[day] ??= { in: 0, out: 0 })[kind] += bytes;
    (months[month] ??= { in: 0, out: 0 })[kind] += bytes;
    const s = Math.floor(t / 1000), slot = ring[s % ring.length];
    if (slot.s !== s) { slot.s = s; slot.in = 0; slot.out = 0; }
    slot[kind] += bytes;
    dirty = true;
  }
  function prune() {
    for (const [map, keep] of [[days, 3], [months, 3]]) {
      const keys = Object.keys(map).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - keep))) delete map[old];
    }
  }
  /** bytes a second over the last RATE_S whole seconds */
  function rate() {
    const s = Math.floor(now() / 1000);
    let bytesIn = 0, bytesOut = 0;
    for (const slot of ring) if (slot.s < s && slot.s >= s - RATE_S) { bytesIn += slot.in; bytesOut += slot.out; }
    return { in: Math.round(bytesIn / RATE_S), out: Math.round(bytesOut / RATE_S) };
  }
  function totals() {
    const iso = new Date(now()).toISOString();
    const day = days[iso.slice(0, 10)] ?? { in: 0, out: 0 }, month = months[iso.slice(0, 7)] ?? { in: 0, out: 0 };
    return { day: { ...day }, month: { ...month } };
  }
  /** this month's share gone so far, at least a day of it, so the first hours do not project wildly */
  function monthElapsed() {
    const t = now(), d = new Date(t);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return Math.max(t - start, 86_400_000) / (end - start);
  }
  function save() {
    if (!dir || !dirty) return;
    prune();
    try { writeJsonFile(dir, "relay-usage.json", { v: 1, days, months }); dirty = false; } catch (error) { console.error(`link: could not save relay usage (${error?.message ?? error})`); }
  }
  return { in: (bytes) => add("in", bytes), out: (bytes) => add("out", bytes), rate, totals, monthElapsed, save };
}
