import * as vps from "../vps-computer.ts";
import { vpsAliasesInPlay } from "../vps-hosts.ts";
import type { AppConfig } from "../config.ts";
import type { BotRecord } from "../store.ts";
import type { TeamComputers } from "../team-computers.ts";
import type { RemoteComputerProvider } from "./config.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ComputerUsageRouteDeps {
  cfg: AppConfig;
  managedVpsOwners(): vps.ManagedVpsOwner[];
  store: { bots: readonly Pick<BotRecord, "vpsAlias">[] };
  teamComputers: Pick<TeamComputers, "list">;
  computerProviderConfigTransitions: Pick<Set<RemoteComputerProvider>, "has">;
}

export function createComputerUsageRoutes(deps: ComputerUsageRouteDeps): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "GET" || path !== "/api/computers/usage") return PASS;
    res.setHeader("cache-control", "private, no-store");
    return json(res, 200, { cloudComputers: await cloudComputers(deps), teamComputers: deps.teamComputers.list().length });
  };
}

async function cloudComputers({ cfg, store, managedVpsOwners, computerProviderConfigTransitions }: ComputerUsageRouteDeps): Promise<number | null> {
  const aliases = vpsAliasesInPlay(cfg, store.bots);
  if (!aliases.length) return 0;
  if (computerProviderConfigTransitions.has("vps")) return null;
  const inventory = await vps.listManagedVpsComputers(cfg, managedVpsOwners(), undefined, aliases);
  return inventory.available ? inventory.instances.length : null;
}
