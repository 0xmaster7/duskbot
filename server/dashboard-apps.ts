import { appSlug } from "../shared/dashboard-protocol.ts";
import type { AppsReport } from "../shared/dashboard-protocol.ts";
import * as composio from "./composio.ts";
import type { AppConfig } from "./config.ts";

export type AppsSource = Pick<typeof composio, "connectorAvailability" | "connectedServicesInventory">;

/** `connect`: apps connected through Composio Connect on a dusk cloud with no key (cloud-composio-connect.ts), null when
 *  it is not signed in */
export async function dashboardApps(cfg: AppConfig, source: AppsSource = composio,
  connect?: () => Promise<Array<{ slug: string; connected: boolean; pending: boolean }> | null>): Promise<AppsReport> {
  if (source.connectorAvailability(cfg) !== "configured") {
    const viaConnect = await connect?.().catch(() => null);
    return viaConnect ? { available: true, complete: true, services: viaConnect.slice(0, 500) } : { available: false, complete: true, services: [] };
  }
  const inventory = await source.connectedServicesInventory(cfg);
  const services = Object.entries(inventory.services).flatMap(([slug, state]) => {
    const id = appSlug(slug);
    return id && (state.connected || state.pending) ? [{ slug: id, connected: state.connected, pending: state.pending }] : [];
  });
  return { available: true, complete: inventory.complete, services: services.slice(0, 500) };
}
