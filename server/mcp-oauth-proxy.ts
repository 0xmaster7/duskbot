// An MCP server the person signed in to reaches an engine as an address on this server, never with its OAuth token:
// requests through it carry the token, refreshed once when the server refuses it.
// Security invariant: the route's bearer works only on its route and only during this boot; the token, the server's
// own headers and the refresh token never leave this process.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import type { McpServerSpec } from "./contracts.ts";
import { harnessPort } from "./harness-port.ts";
import { withoutPendingSignIn, type McpOAuthManager } from "./mcp-oauth.ts";
import { PASS, type RouteContext, type RouteHandler } from "./routes/table.ts";

export const MCP_OAUTH_PROXY_PATH = "/api/internal/mcp-oauth/";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10 * 60_000;
const FORWARDED_REQUEST = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const FORWARDED_RESPONSE = ["content-type", "mcp-session-id", "cache-control"];

type UrlServer = Extract<McpServerSpec, { url: string }>;
interface Route { manager: McpOAuthManager; name: string; url: string; headers: Record<string, string> }

const secret = randomBytes(32);
const routes = new Map<string, Route>();
const routeIds = new WeakMap<McpOAuthManager, Map<string, string>>();

const bearerFor = (routeId: string) => createHmac("sha256", secret).update(routeId).digest("base64url");

function routeFor(manager: McpOAuthManager, name: string, server: UrlServer): string {
  const byServer = routeIds.get(manager) ?? new Map<string, string>();
  routeIds.set(manager, byServer);
  const key = `${name}\u0000${server.url}`;
  let id = byServer.get(key);
  if (!id) {
    id = randomBytes(16).toString("base64url");
    byServer.set(key, id);
  }
  const headers = Object.fromEntries(Object.entries(server.headers ?? {}).filter(([header]) => header.toLowerCase() !== "authorization"));
  routes.set(id, { manager, name, url: server.url, headers });
  return id;
}

/** The servers as an engine gets them: a signed-in one as its proxy address and bearer (dropped when no token can be
 * had), one still waiting for its sign-in left out, the rest as they are. */
export async function engineMcpSignIn(servers: Record<string, McpServerSpec>, manager: McpOAuthManager, port = harnessPort()): Promise<Record<string, McpServerSpec>> {
  const entries = await Promise.all(Object.entries(withoutPendingSignIn(servers, manager)).map(
    async ([name, server]): Promise<[string, McpServerSpec] | null> => {
      if (!("url" in server) || manager.authState(name, server.url) !== "signed-in") return [name, server];
      if (!await manager.accessToken(name, server.url)) return null;
      const id = routeFor(manager, name, server);
      return [name, { ...server, url: `http://127.0.0.1:${port}${MCP_OAUTH_PROXY_PATH}${id}`, headers: { Authorization: `Bearer ${bearerFor(id)}` } }];
    },
  ));
  return Object.fromEntries(entries.filter((entry): entry is [string, McpServerSpec] => entry !== null));
}

function authorized(req: IncomingMessage, routeId: string): boolean {
  const presented = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (!presented) return false;
  const expected = Buffer.from(bearerFor(routeId));
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function rawBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** A JSON-RPC error the engine shows, never a 401: that would start the engine's own sign-in. */
function refuse(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }));
}

export async function mcpOAuthProxyRoutes({ req, res, path, method }: RouteContext): ReturnType<RouteHandler> {
  if (!path.startsWith(MCP_OAUTH_PROXY_PATH)) return PASS;
  const routeId = path.slice(MCP_OAUTH_PROXY_PATH.length);
  const route = routes.get(routeId);
  if (!route || !authorized(req, routeId)) return refuse(res, 403, "This MCP address is not valid. Start a new message.");
  if (!["POST", "GET", "DELETE"].includes(method)) {
    res.writeHead(405, { allow: "POST, GET, DELETE" });
    res.end();
    return;
  }
  const body = method === "POST" ? await rawBody(req) : undefined;
  if (body === null) return refuse(res, 413, "The request to this MCP server is too large.");
  const headers: Record<string, string> = { ...route.headers };
  for (const name of FORWARDED_REQUEST) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const send = (token: string) => fetch(route.url, {
    method, headers: { ...headers, authorization: `Bearer ${token}` }, ...(body ? { body } : {}),
    redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  });
  let answer: Response;
  try {
    const token = await route.manager.accessToken(route.name, route.url);
    if (!token) return refuse(res, 502, `${route.name} needs you to sign in again in dusk bot.`);
    answer = await send(token);
    if (answer.status === 401) {
      void answer.body?.cancel().catch(() => {});
      const fresh = await route.manager.refreshRejected(route.name, route.url, token);
      if (!fresh) return refuse(res, 502, `${route.name} refused its sign-in. Sign in to it again in dusk bot.`);
      answer = await send(fresh);
      if (answer.status === 401) {
        void answer.body?.cancel().catch(() => {});
        return refuse(res, 502, `${route.name} refused its sign-in. Sign in to it again in dusk bot.`);
      }
    }
  } catch (error) {
    if (abort.signal.aborted) return;
    return refuse(res, 502, `${route.name} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  const out: Record<string, string> = {};
  for (const name of FORWARDED_RESPONSE) {
    const value = answer.headers.get(name);
    if (value) out[name] = value;
  }
  res.writeHead(answer.status, out);
  if (!answer.body) {
    res.end();
    return;
  }
  Readable.fromWeb(answer.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
}
