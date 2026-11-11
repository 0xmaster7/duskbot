// A host is one provider as the managed cloud drives it: its adapter, what runs on its machines, its prices and start
// rules, the settings that differ there and the files its ledgers keep. A cloud's record names its host (`managed.host`,
// absent: boat); one lifecycle per host shares everything else (docs/hosts.md).
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";
import { BOAT_IMAGE } from "./home.ts";
import { INSTABOX_IMAGE, PLATFORM_ENTRIES } from "./instabox-home.ts";
import type { ManagedSettings } from "./lifecycle.ts";
import type { ProviderCostProfile } from "./power/cost.ts";
import type { MachineImage, MachineProvider } from "./provider.ts";
import type { HostName } from "./state.ts";

export type { HostName } from "./state.ts";
export const HOST_NAMES: readonly HostName[] = ["boat", "instabox"];

export interface ManagedHost {
  name: HostName;
  provider: MachineProvider;
  image: MachineImage;
  costProfile: ProviderCostProfile;
  /** settings over the deployment's (InstaBox never purges a stopped disk, wakes in seconds) */
  settings?: Partial<ManagedSettings>;
  /** the files of its own ledgers; Boat keeps the names it always had */
  files: { starts: string; spend: string; sweep: string };
  /** top-level entries of the volume the host keeps for itself: a restore leaves them, a migration does not check them */
  keep?: readonly string[];
}

export const hostOf = (c: StoredCloud): HostName => c.managed?.host ?? "boat";

export function boatHost(provider: MachineProvider, costProfile: ProviderCostProfile): ManagedHost {
  return { name: "boat", provider, image: BOAT_IMAGE, costProfile, files: { starts: "provider-starts.json", spend: "spend", sweep: "boat-sweep.json" } };
}

export function instaboxHost(provider: MachineProvider, costProfile: ProviderCostProfile, settings: Partial<ManagedSettings> = {}): ManagedHost {
  return { name: "instabox", provider, image: INSTABOX_IMAGE, costProfile, keep: PLATFORM_ENTRIES,
    settings: { refreshAfterMs: Number.POSITIVE_INFINITY, wakeLeadMs: 2 * 60_000, ...settings },
    files: { starts: "instabox-starts.json", spend: "spend-instabox", sweep: "instabox-sweep.json" } };
}

/** DUSK_MANAGED_HOSTS (the hosts this service drives, default boat) and DUSK_MANAGED_HOST (where new clouds go, default boat) */
export function hostsFromEnv(env: NodeJS.ProcessEnv): { enabled: HostName[]; fallback: HostName } {
  const enabled = (env.DUSK_MANAGED_HOSTS ?? "boat").split(",").map(h => h.trim()).filter(Boolean);
  if (!enabled.length || enabled.some(h => !(HOST_NAMES as readonly string[]).includes(h)) || new Set(enabled).size !== enabled.length) throw new Error("Invalid DUSK_MANAGED_HOSTS.");
  const fallback = env.DUSK_MANAGED_HOST ?? "boat";
  if (!enabled.includes(fallback)) throw new Error("DUSK_MANAGED_HOST must be one of DUSK_MANAGED_HOSTS.");
  return { enabled: enabled as HostName[], fallback: fallback as HostName };
}
