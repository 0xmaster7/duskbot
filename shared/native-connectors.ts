import table from "./native-connectors.json" with { type: "json" };

/** One connector dusk bot signs in to with its own OAuth app (no per-call cost, no app review). Adding one is a row in
 * native-connectors.json plus its client id (and secret, when the vendor needs one) in the release environment. */
export interface NativeConnector {
  id: string;
  label: string;
  domain: string;
  /** "device": the person types a code on the vendor's page. "code": the vendor's page sends the browser back to
   * this computer's loopback address (RFC 8252), with PKCE. */
  flow: "device" | "code";
  /** Names of the environment variables that hold the client: never the values. */
  clientIdEnv: string;
  clientSecretEnv?: string;
  /** device flow */
  deviceUrl?: string;
  /** code flow */
  authorizeUrl?: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query fields the authorize page needs (Google's access_type=offline). */
  authorizeParams?: Record<string, string>;
  /** Who the token signs in as: a GET with the token as a bearer, and the dotted path of the name in its JSON. */
  check: { url: string; label: string };
  /** The vendor's own MCP server, which takes the token as a bearer, or an API origin for dusk bot's api_request tool. */
  use: { mcp: string } | { api: string; docs: string };
}

export const NATIVE_CONNECTORS: readonly NativeConnector[] = table.connectors as NativeConnector[];

export const nativeConnector = (id: string): NativeConnector | undefined => NATIVE_CONNECTORS.find((one) => one.id === id);

/** Every environment variable a release bakes in for these clients. */
export const NATIVE_CLIENT_ENVS: readonly string[] = NATIVE_CONNECTORS.flatMap((one) => [one.clientIdEnv, ...(one.clientSecretEnv ? [one.clientSecretEnv] : [])]);
