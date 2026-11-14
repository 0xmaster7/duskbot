/** "Route traffic through this computer": GET and PUT /api/computer/egress answer this. */
export interface EgressStatus {
  /** A link agent that can route runs on this server: the server is a VPS linked to the person's app. */
  available: boolean;
  enabled: boolean;
  /** `off`; `computer`: new connections leave through the person's computer; `server`: it is offline, so this network. */
  route: "off" | "computer" | "server";
  activeStreams: number;
  relayedStreams: number;
  refusedStreams: number;
  /** "When a site blocks the cloud": a site that blocked a bot computer's browser goes through the person's computer. */
  blockedSitesEnabled: boolean;
  /** The sites that go that way now, for this session. */
  blockedSites: string[];
}
