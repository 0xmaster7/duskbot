// Token apps end to end: check a pasted token live, keep it sealed, and add the app as an MCP server bots already know
// how to use (the vendor's own, or dusk bot's api_request endpoint); device sign-ins for GitHub and Google Drive.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { tokenApp, type DevicePoll, type DeviceStart, type TokenAccountView, type TokenAppId, type TokenAppsStatus } from "../../shared/app-tokens.ts";
import type { StoredMcpServer } from "../mcp-registry.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { handleApiRpc } from "./mcp.ts";
import { deviceClients, pollDevice, refreshDevice, startDevice, type DeviceApp, type DeviceClients, type DeviceTokens } from "./device.ts";
import { accountView, TokenStore, type TokenAccount } from "./store.ts";
import { TokenCheckError, VENDORS, type ApiAccess, type TokenFields } from "./vendors.ts";

export const APP_TOKENS_MCP_PREFIX = "/api/app-tokens/mcp/";
const APP = /^\/api\/app-tokens\/([a-z]{2,20})$/u;
const DEVICE_START = /^\/api\/app-tokens\/([a-z]{2,20})\/device$/u;
const DEVICE_POLL = /^\/api\/app-tokens\/device\/([a-f0-9]{32})$/u;
const ACCOUNT = /^\/api\/app-tokens\/accounts\/([a-f0-9]{16})$/u;
const FIELD_KEYS = ["token", "key", "email", "site", "shop"] as const;
// a device token is refreshed this long before it expires
const REFRESH_AHEAD_MS = 10 * 60_000;

/** What the service needs of the MCP server list: the same writer Settings uses, so policy and limits apply. */
export interface TokenServers {
  names(): string[];
  add(name: string, server: StoredMcpServer): { ok: true } | { ok: false; status: number; error: string };
  replace(name: string, server: StoredMcpServer): void;
  remove(name: string): void;
}

export interface TokenAppsDeps {
  dataDir: string;
  /** The local server's own address, which an api app's MCP entry points at. */
  origin(): string;
  servers: TokenServers;
  clients?: DeviceClients;
  fetch?: typeof fetch;
  now?(): number;
}

interface PendingDevice { app: DeviceApp; deviceCode: string; expiresAt: number; interval: number; nextAt: number; result?: DevicePoll }

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export function freeName(base: string, taken: readonly string[]): string {
  let name = base;
  for (let suffix = 2; taken.includes(name); suffix++) name = `${base}-${suffix}`;
  return name;
}

export function createTokenApps(deps: TokenAppsDeps) {
  const store = new TokenStore(deps.dataDir);
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const clients = deps.clients ?? deviceClients();
  const pending = new Map<string, PendingDevice>();

  const scrub = (text: string) => store.secretValues().reduce((safe, secret) => (safe.includes(secret) ? safe.split(secret).join("[hidden]") : safe), text);

  function serverFor(account: TokenAccount): StoredMcpServer {
    const vendor = VENDORS[account.app];
    if (vendor.mcp) return { type: "http", ...vendor.mcp(account.fields), enabled: true };
    return { type: "http", url: `${deps.origin()}${APP_TOKENS_MCP_PREFIX}${account.id}`, headers: { authorization: `Bearer ${account.mcpKey}` }, enabled: true };
  }

  function status(): TokenAppsStatus {
    return { accounts: store.list().map(accountView), device: { github: Boolean(clients.github), googledrive: Boolean(clients.googledrive) } };
  }

  /** Checks the credentials live, keeps them sealed and adds the app's MCP server. */
  async function connect(app: TokenAppId, fields: TokenFields, via: TokenAccount["via"], tokens?: DeviceTokens): Promise<TokenAccountView> {
    const vendor = VENDORS[app];
    const label = await vendor.check(fields, fetchImpl, AbortSignal.timeout(20_000));
    const id = hex(8);
    const server = freeName(app, deps.servers.names());
    const account: TokenAccount = {
      id, app, label, server, via, connectedAt: now(),
      fields: Object.fromEntries(Object.entries({ ...fields, ...(tokens?.refresh ? { refresh: tokens.refresh } : {}) }).filter(([, value]) => typeof value === "string" && value)) as Record<string, string>,
      ...(vendor.mcp ? {} : { mcpKey: hex(32) }),
      ...(tokens?.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
    };
    store.put(account);
    const added = deps.servers.add(server, serverFor(account));
    if (!added.ok) {
      store.remove(id);
      throw new TokenCheckError("input", added.error);
    }
    return accountView(account);
  }

  /** A device token's next one, saved, and the vendor server's header with it. */
  async function fresh(account: TokenAccount): Promise<TokenAccount> {
    if (!account.expiresAt || account.expiresAt - now() > REFRESH_AHEAD_MS || !account.fields.refresh) return account;
    const app = account.app as DeviceApp;
    const client = clients[app];
    if (!client) return account;
    const tokens = await refreshDevice(app, client, account.fields.refresh, fetchImpl, now());
    const next: TokenAccount = { ...account, fields: { ...account.fields, token: tokens.token, ...(tokens.refresh ? { refresh: tokens.refresh } : {}) }, ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}) };
    store.put(next);
    if (VENDORS[account.app].mcp) deps.servers.replace(account.server, serverFor(next));
    return next;
  }

  async function refreshDue(): Promise<void> {
    for (const account of store.list()) await fresh(account).catch((error) => console.warn(`App tokens: ${account.app} could not refresh its sign-in: ${error instanceof Error ? error.message : error}`));
  }

  function remove(id: string): boolean {
    const gone = store.remove(id);
    if (gone) deps.servers.remove(gone.server);
    return Boolean(gone);
  }

  async function beginDevice(app: DeviceApp): Promise<DeviceStart> {
    const client = clients[app];
    if (!client) throw new TokenCheckError("input", "This sign-in isn't set up in this build. Paste a token instead.");
    const code = await startDevice(app, client, fetchImpl);
    const handle = hex(16);
    for (const [key, entry] of pending) if (entry.expiresAt < now()) pending.delete(key);
    pending.set(handle, { app, deviceCode: code.deviceCode, expiresAt: now() + code.expiresIn * 1000, interval: code.interval, nextAt: now() + code.interval * 1000 });
    return { handle, userCode: code.userCode, verificationUrl: code.verificationUrl, expiresIn: code.expiresIn, interval: code.interval };
  }

  /** One check of a device sign-in; the vendor is asked at most once per its interval, whatever the window does. */
  async function checkDevice(handle: string): Promise<DevicePoll> {
    const entry = pending.get(handle);
    if (!entry) return { status: "failed", message: "This sign-in is over. Start again." };
    if (entry.result) return entry.result;
    if (entry.expiresAt < now()) { pending.delete(handle); return { status: "failed", message: "The code expired. Start again." }; }
    if (now() < entry.nextAt) return { status: "waiting" };
    const client = clients[entry.app]!;
    const answer = await pollDevice(entry.app, client, entry.deviceCode, fetchImpl, now());
    if (answer.status === "waiting") {
      if (answer.slowDown) entry.interval += 5;
      entry.nextAt = now() + entry.interval * 1000;
      return { status: "waiting" };
    }
    if (answer.status === "failed") { entry.result = answer; return answer; }
    try {
      entry.result = { status: "connected", account: await connect(entry.app, { token: answer.tokens.token }, "device", answer.tokens) };
    } catch (error) {
      entry.result = { status: "failed", message: error instanceof Error ? error.message : "The sign-in didn't finish." };
    }
    return entry.result;
  }

  const routes: RouteHandler = async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/app-tokens" && method === "GET") {
      void refreshDue();
      return json(res, 200, status());
    }
    const remove_ = ACCOUNT.exec(path);
    if (remove_ && method === "DELETE") return remove(remove_[1]!) ? json(res, 200, status()) : json(res, 404, { error: "That account isn't connected." });
    const device = DEVICE_START.exec(path);
    if (device && method === "POST") {
      if (device[1] !== "github" && device[1] !== "googledrive") return json(res, 404, { error: "No such sign-in." });
      try { return json(res, 200, await beginDevice(device[1])); }
      catch (error) { return json(res, error instanceof TokenCheckError ? 400 : 502, { error: error instanceof Error ? error.message : "The sign-in didn't start." }); }
    }
    const poll = DEVICE_POLL.exec(path);
    if (poll && method === "GET") {
      try { return json(res, 200, await checkDevice(poll[1]!)); }
      catch { return json(res, 200, { status: "waiting" } satisfies DevicePoll); }
    }
    const app = APP.exec(path);
    if (app && method === "POST") {
      const spec = tokenApp(app[1]!);
      if (!spec || spec.device) return json(res, 404, { error: "No such app." });
      const body = await readBody(req, 20_000).catch(() => null) as { fields?: Record<string, unknown> } | null;
      const fields: TokenFields = {};
      for (const key of FIELD_KEYS) if (typeof body?.fields?.[key] === "string") fields[key] = (body.fields[key] as string).trim();
      try {
        return json(res, 201, { account: await connect(spec.id, fields, "token"), ...status() });
      } catch (error) {
        if (error instanceof TokenCheckError) return json(res, error.kind === "network" ? 502 : 400, { error: error.message, code: `token_${error.kind}` });
        throw error;
      }
    }
    return PASS;
  };

  /** dusk bot's own MCP endpoint for an api app. Security: loopback only, and the entry's own 256-bit bearer. */
  async function mcp(req: IncomingMessage, res: ServerResponse, path: string, method: string, body: () => Promise<unknown>, json: (res: ServerResponse, status: number, body: unknown) => void) {
    const account = store.get(path.slice(APP_TOKENS_MCP_PREFIX.length));
    const presented = /^Bearer ([a-f0-9]{64})$/u.exec(req.headers.authorization ?? "")?.[1];
    const remote = req.socket.remoteAddress ?? "";
    const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (!loopback || !account?.mcpKey || !presented || !timingSafeEqual(Buffer.from(presented), Buffer.from(account.mcpKey))) return json(res, 401, { error: "unauthorized" });
    if (method === "GET" || method === "DELETE") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const vendor = VENDORS[account.app];
    const access = async (): Promise<ApiAccess> => vendor.api!((await fresh(store.get(account.id) ?? account)).fields);
    const message = await body().catch(() => null);
    const answer = Array.isArray(message)
      ? (await Promise.all(message.map((one) => handleApiRpc(one, account.app, access, fetchImpl, scrub)))).filter(Boolean)
      : await handleApiRpc(message, account.app, access, fetchImpl, scrub);
    if (answer === undefined || (Array.isArray(answer) && !answer.length)) { res.writeHead(202); res.end(); return; }
    return json(res, 200, answer);
  }

  /** An api app's entry points at this server's address; a new port fixes it. */
  function repointServers(): void {
    for (const account of store.list()) {
      if (VENDORS[account.app].mcp) continue;
      try { deps.servers.replace(account.server, serverFor(account)); } catch {}
    }
  }

  return { store, status, connect, remove, beginDevice, checkDevice, refreshDue, routes, mcp, scrub, repointServers };
}

export type TokenApps = ReturnType<typeof createTokenApps>;
