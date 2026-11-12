// The egress guard. InstaBox bills what a machine uploads to the internet past the workspace's shared monthly pool, and
// a machine can send 400 to 600 Mbit/s (measured 2026-11-12), so one home running a proxy or a file host could cost
// hundreds of dollars a month. Each
// home's upload in the calendar month (UTC) is read from the provider's own meter (usage().egressBytes) every
// EGRESS_READ_MS while it runs. Past `alert` GB the operator hears once; past `slow` its upload is limited to
// EGRESS_SLOW_MBIT inside the machine (InstaBox has no network limit in its API) and the owner sees why; past `pause` the
// machine is paused, and stays asleep, until the 1st. Everything lifts on the 1st. The limit runs inside a VM whose owner
// has root, so it is put back at every read and after every wake, and a limited machine whose meter shows more than the
// limit lets through is paused at once; the pause is the bound it cannot undo.
import { BILLING_CONFIG } from "../../dashboard/server/billing/plans.ts";
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";
import { monthOf } from "./power/ceiling.ts";
import type { MachineProvider } from "./provider.ts";

export const GB = 1e9;
export const EGRESS_SLOW_MBIT = 5;
/** how often a running home's meter is read (the meter itself showed a 100 MB upload within seconds, 2026-11-12) */
export const EGRESS_READ_MS = 5 * 60_000;
/** a limit that would not go in is tried again this often */
const RETRY_MS = 5 * 60_000;
const HOUR = 3_600_000, LIMIT_BYTES_PER_SECOND = EGRESS_SLOW_MBIT * 1e6 / 8;
/** upload a limited machine may show past what the limit lets through: half again the rate, plus two minutes for the
 *  meter, which InstaBox updates within about 30 seconds */
export function egressTampered(sent: number, ms: number): boolean { return sent > LIMIT_BYTES_PER_SECOND * (1.5 * ms / 1000 + 120); }

export interface EgressLimits { alert: number; slow: number; pause: number }
export type EgressLevel = "ok" | "alert" | "slow" | "pause";

export interface EgressState {
  month: string;
  /** the machine `bytes` is read from */
  serverId: string | null;
  /** the current machine's upload this month, as last read */
  bytes: number;
  /** earlier machines' upload this month (a recovery, a revived archive) */
  carried: number;
  readAt: number | null;
  alertedAt: number | null;
  slowAt: number | null;
  pausedAt: number | null;
  /** the limit was last seen in place on this machine at `at`, first put there at `since` */
  limited: { serverId: string; at: number; since: number } | null;
  /** the reading the tamper rule measures from: an hour after the limit first went in, once the meter shows only limited hours */
  watch: { serverId: string; bytes: number; at: number } | null;
  limitTryAt: number | null;
  limitFailures: number;
  /** a machine an earlier month's limit is still on, lifted when it next runs */
  lift: string | null;
}

/** a plan's thresholds in GB (billing/plans.ts), the smallest plan's for a kind it does not name */
export function egressLimits(kind: string): EgressLimits {
  const table = BILLING_CONFIG.egressGb as Record<string, EgressLimits>;
  return table[kind] ?? BILLING_CONFIG.egressGb.shared_s;
}
export function egressLevel(bytes: number, limits: EgressLimits): EgressLevel {
  return bytes >= limits.pause * GB ? "pause" : bytes >= limits.slow * GB ? "slow" : bytes >= limits.alert * GB ? "alert" : "ok";
}
export const egressTotal = (e: Pick<EgressState, "bytes" | "carried">) => e.carried + e.bytes;
/** when this month's limits lift: the 1st, 00:00 UTC */
export const egressUntil = (t: number) => monthOf(t).end;

export function freshEgress(month: string, serverId: string | null, lift: string | null = null): EgressState {
  return { month, serverId, bytes: 0, carried: 0, readAt: null, alertedAt: null, slowAt: null, pausedAt: null, limited: null, watch: null, limitTryAt: null, limitFailures: 0, lift };
}

// the machine's way out: the interface its default route uses; nft as root (the machine user has passwordless sudo).
// InstaBox's kernel has no shaping qdisc (no tbf, htb or fq; checked 2026-11-12), so the limit is an nftables byte
// policer: packets past the rate are dropped and TCP backs off to it (a 100 MB upload measured 0.64 MB/s)
const PATH = `export PATH="$PATH:/usr/sbin:/sbin"`;
const DEV = `${PATH}; dev=$(ip -o route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \\([^ ]*\\).*/\\1/p'); [ -n "$dev" ] || { echo "no route"; exit 3; }`;
const TABLE = "inet dusk_egress";
// one table replaced whole in one transaction (made first so the delete always finds it); the burst
// holds more than one 64 KB offloaded segment
const RULES = `table ${TABLE}\\ndelete table ${TABLE}\\ntable ${TABLE} {\\n limit cap { rate over ${LIMIT_BYTES_PER_SECOND} bytes/second burst 262144 bytes; }\\n`
  + ` chain sent { type filter hook output priority 0; policy accept; oifname "%s" limit name "cap" drop; }\\n`
  + ` chain passed { type filter hook forward priority 0; policy accept; oifname "%s" limit name "cap" drop; }\\n}\\n`;
/** every packet the machine sends (its bot computers' too, they are forwarded through it) through one shared bucket */
export const EGRESS_LIMIT_COMMAND = `${DEV}; printf '${RULES}' "$dev" "$dev" | sudo -n nft -f - && sudo -n nft list table ${TABLE} | grep -q 'limit name' && echo "limited $dev"`;
export const EGRESS_LIFT_COMMAND = `${PATH}; if sudo -n nft list table ${TABLE} >/dev/null 2>&1; then sudo -n nft delete table ${TABLE} || exit 1; fi; echo lifted`;

export interface EgressGuardDeps {
  provider: Pick<MachineProvider, "usage" | "run">;
  now(): number;
  save(c: StoredCloud): void;
  log(c: StoredCloud, action: string, reason: string, detail?: Record<string, string | number | boolean | null>): void;
  /** the operator's alert; each one is sent once per home per month */
  alert(c: StoredCloud, text: string): void;
  limits?(c: StoredCloud): EgressLimits;
}

export function createEgressGuard(deps: EgressGuardDeps) {
  const { now } = deps;
  const limitsOf = (c: StoredCloud) => deps.limits?.(c) ?? egressLimits(c.kind);
  const gb = (bytes: number) => Math.round(bytes / GB * 10) / 10;

  /** this month's record for the home, carried into a new month or onto a new machine */
  function current(c: StoredCloud): { e: EgressState; changed: boolean } {
    const b = c.managed!, month = monthOf(now()).key;
    let e = b.egress ?? null, changed = false;
    if (!e || e.month !== month) {
      // a new month starts clean; a limit still on a machine is lifted the next time it runs
      const lift = e?.limited && e.limited.serverId === c.serverId ? e.limited.serverId : e?.lift ?? null;
      if (e?.slowAt != null || e?.pausedAt != null) deps.log(c, "egress_lifted", "new_month", { month });
      e = b.egress = freshEgress(month, c.serverId, lift); changed = true;
    }
    if (e.serverId !== c.serverId) { e.carried += e.bytes; e.bytes = 0; e.serverId = c.serverId; e.readAt = null; changed = true; }
    return { e, changed };
  }

  /** one look: the meter read when due, the levels crossed acted on once each, the limit kept in place on a running machine */
  async function step(c: StoredCloud, up: boolean): Promise<void> {
    if (!c.managed || !c.serverId) return;
    const serverId = c.serverId, t = now();
    const { e, changed } = current(c);
    let dirty = changed;
    if (e.lift && e.lift !== serverId) { e.lift = null; dirty = true; }
    if (!up) { if (dirty) deps.save(c); return; }
    if (e.lift) {
      const lifted = await deps.provider.run(serverId, EGRESS_LIFT_COMMAND, 30).catch(() => null);
      if (lifted?.ok) { e.lift = null; deps.log(c, "egress_limit_removed", "new_month"); }
      dirty = true;
    }
    const due = e.readAt === null || t - e.readAt >= EGRESS_READ_MS;
    if (due) {
      const usage = await deps.provider.usage(serverId, monthOf(t).start).catch(() => null);
      e.readAt = t; dirty = true;
      if (usage) e.bytes = Math.max(e.bytes, usage.egressBytes);
      // the limit runs where the owner has root: upload faster than it allows means it was taken off, and that pauses
      const on = e.limited?.serverId === serverId ? e.limited : null;
      if (usage && on && e.pausedAt === null) {
        if (e.watch?.serverId !== serverId) { if (t - on.since >= HOUR) e.watch = { serverId, bytes: e.bytes, at: t }; }
        else if (t - e.watch.at >= 30 * 60_000 && egressTampered(e.bytes - e.watch.bytes, t - e.watch.at)) {
          e.pausedAt = t;
          deps.log(c, "egress_paused", "limit_removed", { gb: gb(egressTotal(e)) });
          deps.alert(c, `cloud ${c.id} sent ${gb(e.bytes - e.watch.bytes)} GB to the internet in ${Math.round((t - e.watch.at) / 60_000)} minutes while limited to ${EGRESS_SLOW_MBIT} Mbit/s (the limit was removed); it is paused until ${new Date(egressUntil(t)).toISOString().slice(0, 10)}`);
        }
      }
      const limits = limitsOf(c), total = egressTotal(e), level = egressLevel(total, limits);
      if (level !== "ok" && e.alertedAt === null) {
        e.alertedAt = t;
        deps.log(c, "egress_alert", "over_alert", { gb: gb(total) });
        deps.alert(c, `cloud ${c.id} sent ${gb(total)} GB to the internet this month (alert at ${limits.alert} GB, slowed at ${limits.slow}, paused at ${limits.pause})`);
      }
      if ((level === "slow" || level === "pause") && e.slowAt === null) { e.slowAt = t; deps.log(c, "egress_slowed", "over_slow", { gb: gb(total), mbit: EGRESS_SLOW_MBIT }); }
      if (level === "pause" && e.pausedAt === null) {
        e.pausedAt = t;
        deps.log(c, "egress_paused", "over_pause", { gb: gb(total) });
        deps.alert(c, `cloud ${c.id} sent ${gb(total)} GB to the internet this month; it is paused until ${new Date(egressUntil(t)).toISOString().slice(0, 10)}`);
      }
    }
    // a cold boot drops the limit and the owner has root: put back after each wake and at every read
    const stale = !e.limited || e.limited.serverId !== serverId || e.limited.at < c.powerSince;
    if (e.slowAt !== null && e.pausedAt === null && (due || stale && (e.limited !== null || e.limitTryAt === null || t - e.limitTryAt >= RETRY_MS))) {
      e.limitTryAt = t; dirty = true;
      const done = await deps.provider.run(serverId, EGRESS_LIMIT_COMMAND, 30).catch(() => null);
      if (done?.ok && done.stdout.includes("limited")) {
        if (!e.limited || e.limited.serverId !== serverId) deps.log(c, "egress_limit_applied", "slowed", { mbit: EGRESS_SLOW_MBIT });
        e.limited = { serverId, at: t, since: e.limited?.serverId === serverId ? e.limited.since : t }; e.limitFailures = 0;
      } else {
        e.limited = null; e.watch = null; e.limitFailures++;
        if (e.limitFailures === 3) deps.alert(c, `cloud ${c.id}: its upload could not be limited (${(done?.stdout ?? "no answer").trim().slice(0, 60)}); it is paused at ${limitsOf(c).pause} GB`);
      }
    }
    if (dirty) deps.save(c);
  }

  return {
    step,
    /** paused for its upload: kept asleep until the month ends */
    paused(c: StoredCloud): boolean {
      const e = c.managed?.egress;
      return !!e && e.pausedAt !== null && e.month === monthOf(now()).key;
    },
    /** what the owner and the operator see */
    view(c: StoredCloud): { bytes: number; state: "ok" | "alerted" | "slowed" | "paused"; until: number | null; limited: boolean } | null {
      const e = c.managed?.egress;
      if (!e || e.month !== monthOf(now()).key) return null;
      const state = e.pausedAt !== null ? "paused" : e.slowAt !== null ? "slowed" : e.alertedAt !== null ? "alerted" : "ok";
      return { bytes: egressTotal(e), state, until: state === "paused" || state === "slowed" ? egressUntil(now()) : null, limited: e.limited !== null && e.limited.serverId === c.serverId };
    },
  };
}
export type EgressGuard = ReturnType<typeof createEgressGuard>;
