// the top accounts table at the head of admin ops: each account's relay bytes this month (and where that puts it on the
// fair use curve), dusk cloud awake hours and cost, and the emails sent to it. built from what is already collected:
// the link nodes' fairUse, the infra usage rows and the "mail" daily counters. never a live third-party call.
import type { OpsAccountFlag, OpsAccountRow, OpsAccountsAnswer, OpsFairStage, OpsRelayCard, OpsSuspect } from "../../../src/admin/ops-types.ts";
import type { InfraDay } from "../infra.ts";
import type { OpsDaily } from "./store.ts";
import { linkAccountRef } from "../../link-grant.ts";
import { median } from "./math.ts";

const GB = 1e9;
/** the link service's defaults (apps/link-service/src/fair-use.mjs), used until a node reports its own */
export const FAIR_USE = { fullSpeedBytes: 20 * GB, floorAtBytes: 80 * GB } as const;
/** a month of sign-in codes past these reads as someone poking at the account, or spraying it */
export const CODE_CHECK = 10, CODE_ABUSE = 30;

export function fairStage(bytes: number, curve: { fullSpeedBytes: number; floorAtBytes: number }): OpsFairStage {
  return bytes < curve.fullSpeedBytes ? "full" : bytes < curve.floorAtBytes ? "slowing" : "chat";
}

export interface TopAccountsInput {
  now: number; month: string; data: string; fixture?: boolean;
  accounts: ReadonlyArray<{ id: string; email: string }>;
  relays: readonly OpsRelayCard[];
  /** this month's infra rows; null when the cloud usage is not readable */
  infra: readonly InfraDay[] | null;
  /** this month's "mail" daily rows (values.sent, values.codes); null when not counted */
  mail: readonly OpsDaily[] | null;
  egress?: (accountId: string) => "slowed" | "paused" | null;
  /** the ops page's people to look at, own data only */
  suspects?: readonly OpsSuspect[];
  limit?: number;
}

export function topAccounts(input: TopAccountsInput): OpsAccountsAnswer {
  const byRef = new Map<string, { id: string; email: string }>();
  for (const account of input.accounts) { byRef.set(linkAccountRef(account.id), account); byRef.set(account.id, account); }
  const emailOf = new Map(input.accounts.map(account => [account.id, account.email]));
  const links = input.relays.filter(card => card.id !== "cloudflare" && card.stats);
  const limits = links.find(card => card.stats?.limits)?.stats?.limits ?? {};
  const curve = {
    fullSpeedBytes: typeof limits.accountFullSpeedBytes === "number" ? limits.accountFullSpeedBytes : FAIR_USE.fullSpeedBytes,
    floorAtBytes: typeof limits.accountFloorAtBytes === "number" ? limits.accountFloorAtBytes : FAIR_USE.floorAtBytes,
  };

  type Row = OpsAccountRow & { key: string };
  const rows = new Map<string, Row>();
  const rowOf = (key: string, accountId: string | null, ref: string | null) => {
    let row = rows.get(key);
    if (!row) rows.set(key, row = { key, accountId, ref, email: accountId ? emailOf.get(accountId) ?? null : null, relay: null, cloud: null, emails: input.mail ? 0 : null, codes: input.mail ? 0 : null, flags: [] });
    return row;
  };

  // every node's fairUse already sums the account over all nodes; take the largest a node saw, so a late sync never halves it
  const fair = new Map<string, { monthBytes: number; bytesPerSec: number }>();
  for (const card of links) for (const one of card.stats?.fairUse?.accounts ?? []) {
    const ref = one.account ?? (one.tunnel ? `t:${one.tunnel}` : null);
    if (!ref || !Number.isFinite(one.monthBytes)) continue;
    const seen = fair.get(ref);
    if (!seen || one.monthBytes > seen.monthBytes) fair.set(ref, { monthBytes: one.monthBytes, bytesPerSec: one.bytesPerSec });
  }
  const reportedRelay = links.some(card => card.stats?.fairUse);
  const nodeTotal = links.reduce((sum, card) => sum + (card.stats?.month.bytesOut ?? 0) + (card.stats?.month.bytesIn ?? 0), 0);
  const total = Math.max(nodeTotal, [...fair.values()].reduce((sum, one) => sum + one.monthBytes, 0));
  for (const [ref, one] of fair) {
    const known = byRef.get(ref);
    const row = rowOf(known ? known.id : `ref:${ref}`, known?.id ?? null, ref);
    row.relay = { monthBytes: one.monthBytes, share: total > 0 ? Math.min(1, one.monthBytes / total) : 0, stage: fairStage(one.monthBytes, curve), bytesPerSec: one.bytesPerSec };
  }

  if (input.infra) {
    const sums = new Map<string, { running: number; cost: number }>();
    for (const day of input.infra) {
      const sum = sums.get(day.accountId) ?? { running: 0, cost: 0 };
      sum.running += day.runningSeconds; sum.cost += day.costCents;
      sums.set(day.accountId, sum);
    }
    for (const [accountId, sum] of sums) rowOf(accountId, accountId, null).cloud = { awakeHours: Math.round(sum.running / 360) / 10, costCents: Math.round(sum.cost), egressState: input.egress?.(accountId) ?? null };
  }

  if (input.mail) for (const day of input.mail) {
    if (!day.accountId) continue;
    const row = rowOf(day.accountId, day.accountId, null);
    row.emails = (row.emails ?? 0) + (day.values.sent ?? 0);
    row.codes = (row.codes ?? 0) + (day.values.codes ?? 0);
  }

  const costs = [...rows.values()].flatMap(row => row.cloud && row.cloud.costCents > 0 ? [row.cloud.costCents] : []);
  const midCost = median(costs);
  const suspects = new Map((input.suspects ?? []).flatMap(s => s.accountId ? [[s.accountId, s] as const] : []));
  for (const row of rows.values()) {
    const flags: OpsAccountFlag[] = [];
    const suspect = row.accountId ? suspects.get(row.accountId) : undefined;
    if (row.relay?.stage === "chat") flags.push({ kind: "abuse", why: `past ${Math.round(curve.floorAtBytes / GB)} gb on the relay, chat speed only` });
    if ((row.codes ?? 0) >= CODE_ABUSE) flags.push({ kind: "abuse", why: `${row.codes} sign-in codes this month` });
    if (suspect && suspect.score >= 10) flags.push({ kind: "abuse", why: suspect.why });
    if (row.relay?.stage === "slowing") flags.push({ kind: "throttled", why: `past ${Math.round(curve.fullSpeedBytes / GB)} gb on the relay, slowed` });
    if (row.cloud?.egressState) flags.push({ kind: "throttled", why: `cloud ${row.cloud.egressState} for traffic` });
    if (suspect && suspect.score < 10) flags.push({ kind: "check", why: suspect.why });
    if (row.cloud && costs.length >= 3 && row.cloud.costCents >= 1_000 && row.cloud.costCents >= midCost * 3) flags.push({ kind: "check", why: `cloud cost ${Math.round(row.cloud.costCents / Math.max(1, midCost) * 10) / 10}x the median` });
    if ((row.codes ?? 0) >= CODE_CHECK && (row.codes ?? 0) < CODE_ABUSE) flags.push({ kind: "check", why: `${row.codes} sign-in codes this month` });
    row.flags = flags;
  }

  const weight = (row: OpsAccountRow) => (row.relay?.monthBytes ?? 0) / GB + (row.cloud?.costCents ?? 0) / 10 + (row.emails ?? 0) + row.flags.length * 1000;
  const list = [...rows.values()].filter(row => row.relay || (row.cloud && (row.cloud.awakeHours > 0 || row.cloud.costCents > 0)) || (row.emails ?? 0) > 0)
    .sort((a, b) => weight(b) - weight(a)).slice(0, input.limit ?? 200).map(({ key: _key, ...row }) => row);
  return { now: input.now, month: input.month, data: input.data, fixture: !!input.fixture, fairUse: curve,
    reported: { relay: reportedRelay, cloud: !!input.infra, mail: !!input.mail }, rows: list };
}
