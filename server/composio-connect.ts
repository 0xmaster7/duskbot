// Composio Connect: Composio's own MCP server for people (docs.composio.dev, "Composio Connect"). It signs in with OAuth
// 2.1, dynamic client registration and PKCE, which server/mcp-oauth.ts already runs for any MCP server, so connecting
// apps needs no Composio key. The person adds it as an MCP server and signs in on Composio's page; then its
// COMPOSIO_MANAGE_CONNECTIONS tool checks one app's connection and, when there is none, starts it and returns the
// sign-in link (docs.composio.dev/toolkits/meta-tools/manage_connections).
import { RemoteMcpClient, MAX_REMOTE_MCP_BYTES } from "./mcp-http.ts";
import { parseStoredMcpServer, type StoredRemoteMcpServer } from "./mcp-registry.ts";
import type { RemoteMcpSpec } from "./contracts.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const COMPOSIO_CONNECT_URL = "https://connect.composio.dev/mcp";
export const COMPOSIO_CONNECT_SERVER = "composio-connect";
const MANAGE_TOOL = "COMPOSIO_MANAGE_CONNECTIONS";
const CALL_MS = 30_000;

/** Composio Connect, when the person has added it: any server at its address, whatever they named it. */
export function composioConnectServer(servers: Record<string, unknown> | undefined): { name: string; server: StoredRemoteMcpServer } | null {
  for (const [name, raw] of Object.entries(servers ?? {})) {
    const parsed = parseStoredMcpServer(name, raw);
    if (!parsed.ok || !("url" in parsed.server)) continue;
    try {
      if (new URL(parsed.server.url).host === new URL(COMPOSIO_CONNECT_URL).host) return { name, server: parsed.server };
    } catch { /* not a url */ }
  }
  return null;
}

export type AppConnection = { status: "connected" } | { status: "started"; url: string } | { status: "failed"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parsedText(result: unknown): unknown {
  if (!isRecord(result)) return null;
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const text = Array.isArray(result.content)
    ? result.content.flatMap((part) => isRecord(part) && typeof part.text === "string" ? [part.text] : []).join("\n")
    : "";
  try { return JSON.parse(text); } catch { return text; }
}

const LINK = /https:\/\/[^\s"')\]]+/;

/** What the tool said about one app. The docs give `data.results` keyed by toolkit, a `summary` of active and initiated
 * connections, and a `redirect_url` to show when it needs connecting; each result's own fields are read loosely, since
 * the docs do not spell them out. */
export function readAppConnection(result: unknown, slug: string): AppConnection {
  const answer = parsedText(result);
  const isError = isRecord(result) && result.isError === true;
  if (typeof answer === "string") {
    const link = LINK.exec(answer)?.[0];
    if (link && !isError) return { status: "started", url: link };
    return { status: "failed", message: answer.slice(0, 300) || "Composio did not answer." };
  }
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : isRecord(answer) ? answer : {};
  const results = isRecord(data.results) ? data.results : {};
  const key = Object.keys(results).find((name) => name.toLowerCase() === slug.toLowerCase());
  const mine = key ? results[key] : undefined;
  const fields = isRecord(mine) ? mine : {};
  const status = String(fields.status ?? fields.connection_status ?? "").toLowerCase();
  const url = [fields.redirect_url, fields.redirectUrl, fields.auth_url, fields.url].find((value): value is string => typeof value === "string" && value.startsWith("https://"))
    ?? LINK.exec(JSON.stringify(mine ?? ""))?.[0];
  if (/^(active|connected)$/.test(status) || fields.has_active_connection === true || fields.connected === true) return { status: "connected" };
  if (url) return { status: "started", url };
  const summary = isRecord(data.summary) ? data.summary : {};
  if (!key && Number(summary.total_toolkits) === 1 && Number(summary.active_connections) === 1) return { status: "connected" };
  const said = typeof fields.message === "string" ? fields.message : typeof data.message === "string" ? data.message : typeof (answer as Record<string, unknown>)?.error === "string" ? String((answer as Record<string, unknown>).error) : "";
  return { status: "failed", message: said.slice(0, 300) || `Composio did not say how to connect ${slug}.` };
}

/** Asks Composio Connect about one app; starts its connection when it has none. */
export async function manageAppConnection(spec: RemoteMcpSpec, slug: string, signal?: AbortSignal): Promise<AppConnection> {
  const bound = signal ? AbortSignal.any([signal, AbortSignal.timeout(CALL_MS)]) : AbortSignal.timeout(CALL_MS);
  const client = new RemoteMcpClient(spec, { maxBytes: MAX_REMOTE_MCP_BYTES });
  try {
    await client.initialize("OpenMausBot", bound);
    return readAppConnection(await client.request("tools/call", { name: MANAGE_TOOL, arguments: { toolkits: [slug] } }, bound), slug);
  } finally {
    await client.close().catch(() => {});
  }
}

const APP = /^\/api\/connectors\/composio-connect\/apps\/([a-z0-9][a-z0-9_-]{0,63})$/;

/** GET /api/connectors/composio-connect: is it added and signed in. POST …/apps/<slug>: connect that app through it. */
export function createComposioConnectRoutes(deps: {
  servers: () => Record<string, unknown> | undefined;
  signedIn: (name: string, server: StoredRemoteMcpServer) => boolean;
  /** The server with its OAuth token on, or null when the sign-in is gone. */
  withToken: (name: string, server: StoredRemoteMcpServer) => Promise<RemoteMcpSpec | null>;
  refusal: (slug: string) => string | null;
  manage?: typeof manageAppConnection;
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path === "/api/connectors/composio-connect" && method === "GET") {
      const found = composioConnectServer(deps.servers());
      return json(res, 200, { added: Boolean(found), name: found?.name ?? null, signedIn: found ? deps.signedIn(found.name, found.server) : false, enabled: found?.server.enabled ?? false });
    }
    const m = APP.exec(path);
    if (!m || method !== "POST") return PASS;
    const refused = deps.refusal(m[1]!);
    if (refused) return json(res, 403, { error: refused, code: "managed_policy" });
    const found = composioConnectServer(deps.servers());
    if (!found) return json(res, 409, { error: "Sign in with Composio first.", code: "composio_connect_missing" });
    const spec = deps.signedIn(found.name, found.server) ? await deps.withToken(found.name, found.server) : null;
    if (!spec) return json(res, 409, { error: "Sign in with Composio again.", code: "composio_connect_signed_out" });
    try {
      return json(res, 200, await (deps.manage ?? manageAppConnection)(spec, m[1]!));
    } catch (error) {
      return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
