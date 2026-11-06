/** Where a Connect apps entry comes from: an aggregator's catalog, or the app's own hosted MCP server. */
export type DirectorySource = "composio" | "remote-mcp";

/** One app any connector provider can connect, as GET /api/connectors/directory sends it. */
export interface DirectoryApp {
  /** Stable within its source: a Composio toolkit slug, or a remote MCP app id (also its default server name). */
  id: string;
  source: DirectorySource;
  label: string;
  description: string;
  /** The provider's own category words; the window maps them onto its categories. */
  categories: string[];
  /** The app's site, for its icon through /api/site-icon and its Website fact. */
  domain: string | null;
  logo: string | null;
  /** remote-mcp only: the vendor's streamable HTTP endpoint. */
  url?: string;
  /** remote-mcp only: "oauth" signs in in the browser (dynamic client registration), "none" needs no sign-in. */
  auth?: "oauth" | "none";
}

export interface DirectoryProviderState {
  id: DirectorySource;
  /** False when the provider is not set up here (no Composio key or broker). */
  available: boolean;
  ok: boolean;
  count: number;
  error?: string;
}

export interface DirectoryAnswer {
  apps: DirectoryApp[];
  providers: DirectoryProviderState[];
}

/** One key per real app across providers, so Notion from Composio and Notion's own server are one row. */
export function directoryKey(name: string): string {
  return name.toLowerCase().trim().replace(/\.(com|io|ai|app|dev|so|co)$/, "").replace(/[^a-z0-9]/g, "");
}
