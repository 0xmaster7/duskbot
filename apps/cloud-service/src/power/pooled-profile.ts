// A synthetic provider for exercising the policy, the rails and the cost ceiling where starts are scarce: each plan
// includes so many starts per rolling minute, hour and day, extra ones cost 3, 5 then 7 cents up to a hard cap, and a
// resume within ten minutes of a stop usually finds the machine kept. Tests and the simulator's comparisons only.
import type { MachineSpec } from "../../../../shared/billing-api.ts";
import type { ProviderCostProfile } from "./cost.ts";

export const POOLED_SIZES = [
  { vcpu: 2, ramGb: 4, diskGb: 51 }, { vcpu: 4, ramGb: 8, diskGb: 51 }, { vcpu: 8, ramGb: 16, diskGb: 111 }, { vcpu: 16, ramGb: 32, diskGb: 251 },
] as const;
const RATES = [1.8, 3.6, 7.2, 20];
export function pooledHourlyCents(spec: MachineSpec): number {
  const at = POOLED_SIZES.findIndex(z => z.vcpu >= spec.vcpu && z.ramGb >= spec.ramGb);
  return RATES[at === -1 ? RATES.length - 1 : at]!;
}
export const POOL_PLANS = {
  trial: { minute: 5, hour: 25, day: 75 },
  "20": { minute: 12, hour: 60, day: 200 },
  "100": { minute: 30, hour: 210, day: 840 },
  "500": { minute: 65, hour: 420, day: 1680 },
  "2000": { minute: 90, hour: 600, day: 2400 },
} as const;
export type PoolPlan = keyof typeof POOL_PLANS;
const HARD_FACTOR = { minute: 3, hour: 6, day: 6 } as const;

/** `scale` multiplies the pool (one user's share of a big plan in the simulator) */
export function pooledCostProfile(options: { plan?: PoolPlan; scale?: number; heldProbability?: number; coldWakeMs?: number; heldWakeMs?: number } = {}): ProviderCostProfile {
  const base = POOL_PLANS[options.plan ?? "20"], scale = options.scale ?? 1;
  const included = { minute: base.minute * scale, hour: base.hour * scale, day: base.day * scale };
  const hardCap = { minute: included.minute * HARD_FACTOR.minute, hour: included.hour * HARD_FACTOR.hour, day: included.day * HARD_FACTOR.day };
  return {
    computeCentsPerHour: pooledHourlyCents,
    floorCentsPerHour: Math.min(...POOLED_SIZES.map(z => pooledHourlyCents(z))),
    included, hardCap,
    startCents(used) {
      let price = 0;
      for (const w of ["minute", "hour", "day"] as const) {
        const ratio = (used[w] + 1) / Math.max(1e-9, included[w]);
        const bracket = ratio <= 1 ? 0 : ratio <= 1.5 ? 3 : ratio <= 2 ? 5 : ratio <= HARD_FACTOR[w] ? 7 : Number.POSITIVE_INFINITY;
        price = Math.max(price, bracket);
      }
      return price;
    },
    held: { windowMs: 10 * 60_000, probability: options.heldProbability ?? 0.7 },
    wakeMs: { cold: options.coldWakeMs ?? 60_000, held: options.heldWakeMs ?? 15_000 },
  };
}
