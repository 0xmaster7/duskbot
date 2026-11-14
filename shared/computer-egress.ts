/** "Route traffic through this computer": GET and PUT /api/computer/egress answer this. */
export interface EgressStatus {
  /** A link agent that can route runs on this server: the server is a VPS linked to the person's app. */
  available: boolean;
  enabled: boolean;
  /** `off`; `computer`: new connections leave through the person's computer; `server`: this network, because it is offline or its path is slow. */
  route: "off" | "computer" | "server";
  /** The link agent heard from the person's computer recently. `route` can be `server` while this is true (a slow path). */
  computerOnline: boolean;
  activeStreams: number;
  relayedStreams: number;
  refusedStreams: number;
  /** "When a site blocks the cloud": a site that blocked a bot computer's browser goes through the person's computer. */
  blockedSitesEnabled: boolean;
  /** The sites that go that way now, for this session. */
  blockedSites: string[];
}

/** What the route means for the person: only a computer the link agent has not heard from reads as offline. */
export function egressRouteState(status: Pick<EgressStatus, "available" | "enabled" | "route"> & { computerOnline?: boolean }): "off" | "computer" | "slow" | "offline" | "unknown" {
  if (!status.enabled) return "off";
  if (status.route === "computer") return "computer";
  if (!status.available || typeof status.computerOnline !== "boolean") return "unknown";
  return status.computerOnline ? "slow" : "offline";
}
