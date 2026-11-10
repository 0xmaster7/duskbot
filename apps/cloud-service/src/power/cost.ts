// What keeping a home up and starting it again cost, for any provider. A provider describes itself once, as a
// ProviderCostProfile (its adapter builds one); the policy, the rails and the simulator only ever read this shape.
import type { MachineSpec } from "../../../../shared/billing-api.ts";

export const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export type PoolWindow = "minute" | "hour" | "day";
export const POOL_WINDOWS: readonly PoolWindow[] = ["minute", "hour", "day"];
export const WINDOW_MS: Readonly<Record<PoolWindow, number>> = { minute: MINUTE, hour: HOUR, day: DAY };
export type PoolCounts = Record<PoolWindow, number>;

/** a provider's prices and start rules, as the lifecycle needs them */
export interface ProviderCostProfile {
  /** compute per hour while running, in cents (billed per second, nothing while stopped) */
  computeCentsPerHour(spec: MachineSpec): number;
  /** starts the account's plan includes per rolling window, and past how many the provider refuses one */
  included: Readonly<PoolCounts>;
  hardCap: Readonly<PoolCounts>;
  /** the cash price of one more start with `used` starts already in each rolling window; Infinity when it would be refused */
  startCents(used: Readonly<PoolCounts>): number;
  /** a resume this soon after a stop usually takes back the kept machine: no start counted, no restore */
  held: { windowMs: number; probability: number };
  /** how long a person waits for a cold wake and for a held one, until the home answers */
  wakeMs: { cold: number; held: number };
}

/** the policy's prices for what cash does not show: an included start still spends the shared pool, and every start
 *  can fail or wake slowly; a person (or a connector's sender) waiting for a cold wake is a cost too */
export interface ShadowPrices {
  /** an included start while the pool is far from full */
  includedStartCents: number;
  /** added to every start: the chance it fails or hydrates slowly */
  startRiskCents: number;
  /** one cold wake a person waits through */
  userWaitCents: number;
  /** one cold wake a connector event (a Slack mention, a webhook) waits through */
  connectorWaitCents: number;
}

/** how full the fullest window would be after one more start, as a share of its included starts */
export function poolFill(profile: ProviderCostProfile, used: Readonly<PoolCounts>, windows: readonly PoolWindow[] = ["hour", "day"]): number {
  return Math.max(...windows.map(w => (used[w] + 1) / Math.max(1, profile.included[w])));
}

/** the first paid start's price: what an included one is worth once the pool runs out */
export function firstPaidCents(profile: ProviderCostProfile): number {
  const at = { minute: 0, hour: 0, day: profile.included.day };
  const price = profile.startCents(at);
  return Number.isFinite(price) && price > 0 ? price : 3;
}

/** what the next start is worth to us: its cash price when it is paid; an included one's shadow price, rising toward the
 *  first paid price as the day and hour windows fill past half; Infinity when the provider would refuse it */
export function startValueCents(profile: ProviderCostProfile, used: Readonly<PoolCounts>, prices: ShadowPrices): number {
  const cash = profile.startCents(used);
  if (!Number.isFinite(cash)) return cash;
  if (cash > 0) return cash + prices.startRiskCents;
  const fill = poolFill(profile, used), paid = firstPaidCents(profile);
  const ramp = Math.min(1, Math.max(0, (fill - 0.5) / 0.5)) ** 2;
  return prices.includedStartCents + (Math.max(paid, prices.includedStartCents) - prices.includedStartCents) * ramp + prices.startRiskCents;
}

/** the break-even: how long staying up costs the same as one start */
export function breakEvenMs(startCents: number, hourlyCents: number): number {
  return Number.isFinite(startCents) ? (startCents / Math.max(1e-9, hourlyCents)) * HOUR : Number.POSITIVE_INFINITY;
}
