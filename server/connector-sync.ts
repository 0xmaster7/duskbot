// Connectors follow the person across every place of their own: this computer, My Cloud and servers of their own. The
// desktop app's main process reads each place's connectors here (names and digests, never a secret) and brings them
// level (electron/connector-sync.mjs): a server added or removed in one place is added or removed in the others, and a
// sign-in made in one place is used in all of them.
//
// A sign-in's refresh token may rotate on use, and a spent one may end every copy of it, so exactly one place keeps it
// (the holder) and refreshes. Every other place gets the holder's access token lent (McpOAuthManager.borrow), never
// refreshes it, and gets the next one from the holder through the app. A sign-out anywhere ends the sign-in everywhere:
// each place keeps when it was signed in and signed out, by address, and the later one wins.
//
// Secrets leave this computer's server only over the desktop's private port (login-handoff.ts); a Cloud or a server of
// the person's own hands them only to its owner's session. Nothing here logs a token.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { addressHere, signInDigest } from "./cloud-connections.ts";
import type { AppConfig } from "./config.ts";
import type { McpConfig } from "./host/mcp-config.ts";
import { parseMcpOAuthRecord } from "./mcp-oauth-store.ts";
import type { McpOAuthManager } from "./mcp-oauth.ts";
import { isRemoteMcpServer, mcpServerBody, parseMcpServerMutation, parseStoredMcpServer, type StoredRemoteMcpServer } from "./mcp-registry.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

const FILE = "connector-sync.json";
/** A removal or sign-out is remembered this long: every place the app reaches in that time hears of it. */
const TOMBSTONE_MS = 90 * 24 * 60 * 60_000;
const NAME = /^[a-z][a-z0-9_-]{0,31}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

const timesSchema = z.object({
  added: z.record(z.string(), z.number()).default({}),
  removed: z.record(z.string(), z.number()).default({}),
  signedIn: z.record(z.string(), z.number()).default({}),
  signedOut: z.record(z.string(), z.number()).default({}),
});
type Times = z.infer<typeof timesSchema>;

export interface SyncSignIn {
  role: "holder" | "lent" | "needs-sign-in" | "none";
  /** The access token in a digest: two places using the same token have the same one. */
  digest?: string;
  expiresAt?: number;
  /** When the sign-in this place uses was made, here or at its holder. */
  signedInAt?: number;
  /** A lent token: the place that lent it. */
  from?: string;
}

export interface SyncServer { name: string; url: string; enabled: boolean; addedAt: number; signIn: SyncSignIn }

export interface SyncListing {
  place: { id: string; label: string };
  servers: SyncServer[];
  removed: Record<string, number>;
  signedOut: Record<string, number>;
}

export const tokenDigest = (access: string) => createHash("sha256").update(`omb-connector:${access}`).digest("hex");

/** A server reached by URL that any place of the person's can reach: not one only this computer's network reaches, and
 * not one marked as running on another computer. */
export function syncable(server: unknown): server is StoredRemoteMcpServer {
  if (!isRemoteMcpServer(server as StoredRemoteMcpServer) || (server as StoredRemoteMcpServer).runsOn) return false;
  return !addressHere((server as StoredRemoteMcpServer).url);
}

export interface ConnectorSyncDeps {
  dataDir: string;
  config(): AppConfig;
  mcpConfig: Pick<McpConfig, "add" | "replace" | "remove" | "setEnabled">;
  mcpOAuth: Pick<McpOAuthManager, "syncRole" | "lend" | "borrow" | "keepAsLent" | "signOut" | "signInRecord" | "adopt">;
  place: { id: string; label: string };
  now?(): number;
}

export function createConnectorSync(deps: ConnectorSyncDeps) {
  const file = join(deps.dataDir, FILE);
  const now = deps.now ?? Date.now;
  const read = (): Times => {
    try { return timesSchema.parse(JSON.parse(readFileSync(file, "utf8"))); } catch { return timesSchema.parse({}); }
  };
  const write = (times: Times) => {
    const cutoff = now() - TOMBSTONE_MS;
    for (const map of [times.removed, times.signedOut]) for (const [url, at] of Object.entries(map)) if (at < cutoff) delete map[url];
    try { writeFileAtomic(file, JSON.stringify(times), { mode: 0o600 }); } catch {}
  };
  const change = (edit: (times: Times) => void) => { const times = read(); edit(times); write(times); };

  const remote = (name: string): StoredRemoteMcpServer | null => {
    const raw = deps.config().mcpServers?.[name];
    const parsed = raw === undefined ? null : parseStoredMcpServer(name, raw);
    return parsed?.ok && isRemoteMcpServer(parsed.server) ? parsed.server : null;
  };

  /** When the sign-in this place holds was made: known from the sign-in or the move that brought it, else from the
   * first time it was seen. */
  function signedInAt(times: Times, url: string): number {
    times.signedIn[url] ??= now();
    return times.signedIn[url]!;
  }

  function list(): SyncListing {
    const times = read();
    const before = JSON.stringify(times);
    const servers: SyncServer[] = [];
    for (const [name, raw] of Object.entries(deps.config().mcpServers ?? {})) {
      const parsed = parseStoredMcpServer(name, raw);
      if (!parsed.ok || !syncable(parsed.server)) continue;
      const { url, enabled } = parsed.server;
      times.added[url] ??= now();
      const role = deps.mcpOAuth.syncRole(name, url);
      let signIn: SyncSignIn = { role: role.role };
      if (role.role === "holder") signIn = { role: "holder", digest: tokenDigest(role.access!), ...(role.expiresAt ? { expiresAt: role.expiresAt } : {}), signedInAt: signedInAt(times, url) };
      else {
        delete times.signedIn[url];
        if (role.role === "lent") signIn = { role: "lent", digest: tokenDigest(role.access!), ...(role.expiresAt ? { expiresAt: role.expiresAt } : {}), signedInAt: role.grantAt!, from: role.from! };
      }
      servers.push({ name, url, enabled, addedAt: times.added[url]!, signIn });
    }
    if (JSON.stringify(times) !== before) write(times);
    return { place: deps.place, servers, removed: { ...times.removed }, signedOut: { ...times.signedOut } };
  }

  type Done = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };
  const refuse = (status: number, error: string): Done => ({ ok: false, status, error });
  const okay = (body: Record<string, unknown> = {}): Done => ({ ok: true, body });
  const failed = (result: { status: number } & ({ error: string } | { body: unknown })): Done | null =>
    "error" in result ? refuse(result.status, result.error) : null;

  return {
    list,

    /** Someone added or edited a server here by hand. */
    added(url: string): void { change((times) => { times.added[url] = now(); }); },
    /** Someone removed a server here by hand. */
    removed(url: string): void { change((times) => { times.removed[url] = now(); delete times.added[url]; delete times.signedIn[url]; }); },
    /** Someone signed out of a server here by hand. */
    signedOut(url: string): void { change((times) => { times.signedOut[url] = now(); delete times.signedIn[url]; }); },
    /** A sign-in was made here just now. */
    signedIn(url: string): void { change((times) => { times.signedIn[url] = now(); }); },

    /** Adds (or updates) a server another place has, as it is there. */
    put(name: string, body: unknown, addedAt: number): Done {
      if (!NAME.test(name)) return refuse(400, "bad name");
      const parsed = parseMcpServerMutation(name, mcpServerBody(body), remote(name) ?? undefined);
      if (!parsed.ok) return refuse(400, parsed.error);
      const server = parsed.server;
      if (!syncable(server)) return refuse(400, "Only a server every place reaches by its address follows the person.");
      const here = remote(name);
      if ((deps.config().mcpServers?.[name] !== undefined && !here) || (here && here.url !== server.url)) return refuse(409, "Another server here has this name.");
      const result = here ? deps.mcpConfig.replace(name, server) : deps.mcpConfig.add(name, server);
      const bad = failed(result);
      if (bad) return bad;
      change((times) => { times.added[server.url] = Math.max(addedAt, times.added[server.url] ?? 0); delete times.removed[server.url]; });
      return okay();
    },

    /** Removes a server, as it was removed at `at` in another place. */
    remove(name: string, at: number): Done {
      const here = remote(name);
      if (!here) return okay({ gone: true });
      const bad = failed(deps.mcpConfig.remove(name));
      if (bad) return bad;
      change((times) => { times.removed[here.url] = Math.max(at, times.removed[here.url] ?? 0); delete times.added[here.url]; delete times.signedIn[here.url]; });
      return okay();
    },

    /** Signs out here, as the person signed out at `at` in another place. */
    async signOut(name: string, at: number): Promise<Done> {
      const here = remote(name);
      if (!here) return okay({ gone: true });
      await deps.mcpOAuth.signOut(name, here.url);
      change((times) => { times.signedOut[here.url] = Math.max(at, times.signedOut[here.url] ?? 0); delete times.signedIn[here.url]; });
      return okay();
    },

    /** Takes a token another place lent. */
    borrow(name: string, body: unknown): Done {
      const parsed = z.object({ access: z.string().min(1).max(16_384), expiresAt: z.number().optional(), from: z.string().min(1).max(200), grantAt: z.number() }).strict().safeParse(body);
      if (!parsed.success) return refuse(400, "send {access, expiresAt, from, grantAt}");
      const here = remote(name);
      if (!here || !syncable(here)) return refuse(404, "This server is not here.");
      if ((read().signedOut[here.url] ?? 0) >= parsed.data.grantAt) return okay({ ended: true });
      return okay({ [deps.mcpOAuth.borrow(name, here.url, parsed.data)]: true });
    },

    /** Holds a sign-in another place gave up for this one. `replaces`: the digest of one this place took before. */
    adopt(name: string, body: unknown, replaces: string | null): Done {
      const input = z.object({ record: z.unknown(), signedInAt: z.number() }).safeParse(body);
      const record = input.success ? parseMcpOAuthRecord(input.data.record) : null;
      if (!input.success || !record) return refuse(400, "send {record, signedInAt}");
      const here = remote(name);
      if (!here || here.url !== record.url) return refuse(404, "This server is not here.");
      const { lent: _lent, ...own } = record;
      const outcome = deps.mcpOAuth.adopt(name, here.url, own, replaces ? (current) => signInDigest(current.tokens) === replaces : undefined);
      if (outcome === "adopted") change((times) => { times.signedIn[here.url] = input.data.signedInAt; });
      return okay({ [outcome]: true });
    },

    // What only the person's own session (or this computer's private port) is answered.

    /** The holder's access token, for another place. */
    async lend(name: string): Promise<Done> {
      const here = remote(name);
      if (!here) return refuse(404, "This server is not here.");
      const token = await deps.mcpOAuth.lend(name, here.url);
      if (!token) return refuse(409, "This place does not hold this sign-in.");
      const times = read();
      const grantAt = signedInAt(times, here.url);
      write(times);
      return okay({ access: token.access, ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}), grantAt });
    },

    /** A server as it is stored here, its secrets with it. */
    definition(name: string): Done {
      const here = remote(name);
      if (!here || !syncable(here)) return refuse(404, "This server is not here.");
      const { runsOn: _runsOn, ...server } = here;
      return okay({ server, addedAt: read().added[here.url] ?? now() });
    },

    /** The sign-in this place holds, for the place that will hold it next. */
    take(name: string): Done {
      const here = remote(name);
      const record = here ? deps.mcpOAuth.signInRecord(name, here.url) : undefined;
      if (!here || !record?.tokens || record.lent || record.state !== "signed-in") return refuse(409, "This place does not hold this sign-in.");
      const times = read();
      const at = signedInAt(times, here.url);
      write(times);
      return okay({ record, digest: signInDigest(record.tokens), signedInAt: at });
    },

    /** Lets go of a sign-in another place holds now, keeping its access token as lent; `changed` when it refreshed
     * here since it was taken, so the newer one goes first. */
    release(name: string, digest: string, to: string): Done {
      const here = remote(name);
      const record = here ? deps.mcpOAuth.signInRecord(name, here.url) : undefined;
      if (!here || !record?.tokens || record.lent) return okay({ released: true });
      if (signInDigest(record.tokens) !== digest) return okay({ changed: true });
      const times = read();
      const grantAt = signedInAt(times, here.url);
      delete times.signedIn[here.url];
      write(times);
      deps.mcpOAuth.keepAsLent(name, here.url, to, grantAt);
      return okay({ released: true });
    },
  };
}

export type ConnectorSync = ReturnType<typeof createConnectorSync>;

/** What the desktop asks this computer's server over its private port. */
export type ConnectorHandoffWhat =
  | { kind: "connector"; op: "lend" | "definition" | "take"; name: string }
  | { kind: "connector"; op: "release"; name: string; digest: string; to: string };

export function parseConnectorHandoff(what: Record<string, unknown> | null): ConnectorHandoffWhat | null {
  if (what?.kind !== "connector" || typeof what.name !== "string" || !NAME.test(what.name)) return null;
  if (what.op === "lend" || what.op === "definition" || what.op === "take") return { kind: "connector", op: what.op, name: what.name };
  if (what.op === "release" && typeof what.digest === "string" && DIGEST.test(what.digest) && typeof what.to === "string" && what.to.length > 0 && what.to.length <= 200) {
    return { kind: "connector", op: "release", name: what.name, digest: what.digest, to: what.to };
  }
  return null;
}

export async function answerConnectorHandoff(sync: ConnectorSync, what: ConnectorHandoffWhat): Promise<{ ok: true; connector: Record<string, unknown> } | { ok: false; error: string }> {
  let done;
  if (what.op === "release") done = sync.release(what.name, what.digest, what.to);
  else if (what.op === "lend") done = await sync.lend(what.name);
  else if (what.op === "definition") done = sync.definition(what.name);
  else done = sync.take(what.name);
  return done.ok ? { ok: true, connector: done.body } : { ok: false, error: done.error };
}

const SERVER = /^\/api\/connector-sync\/servers\/([a-z][a-z0-9_-]{0,31})(?:\/(lent|sign-in|sign-out|lend|definition|take|release))?$/u;

/**
 * GET /api/connector-sync: this place's connectors, by name and digest. The desktop then brings them level:
 *   PUT    …/servers/<name>            {server, addedAt}        add or update a server as another place has it
 *   DELETE …/servers/<name>?at=<ms>                             remove it, as removed elsewhere then
 *   POST   …/servers/<name>/sign-out   {at}                     sign out, as signed out elsewhere then
 *   PUT    …/servers/<name>/lent       {access, expiresAt, from, grantAt}   use a token another place lent
 *   PUT    …/servers/<name>/sign-in    {record, signedInAt}     hold a sign-in another place gave up
 * and, on a Cloud or a server of the person's own, only to the owner's session (this computer answers them over its
 * private port instead):
 *   POST   …/servers/<name>/lend | take | release {digest, to}   GET …/servers/<name>/definition
 */
export function createConnectorSyncRoutes(deps: {
  sync: ConnectorSync;
  /** The person's own place, answering the person: a Cloud home, or a server of one person's own from their session. */
  owners(auth: RequestAuth): boolean;
  /** A Team Cloud refuses a person's own connections. */
  refusal?(what: string): string | null;
}): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== "/api/connector-sync" && !path.startsWith("/api/connector-sync/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (path === "/api/connector-sync") return method === "GET" ? json(res, 200, deps.sync.list()) : json(res, 405, { error: "method not allowed" });
    const m = SERVER.exec(path);
    if (!m) return json(res, 404, { error: "not found" });
    const [, name, action] = m as unknown as [string, string, string | undefined];
    const refused = deps.refusal?.(name);
    if (refused) { req.resume(); return json(res, 403, { error: refused }); }
    const answer = (done: { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }) =>
      done.ok ? json(res, 200, done.body) : json(res, done.status, { error: done.error });
    const body = async () => {
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return undefined;
      return readBody(req, 64 * 1024);
    };
    const at = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

    if (!action) {
      if (method === "PUT") {
        const sent = await body() as { server?: unknown; addedAt?: unknown } | undefined;
        const added = at(sent?.addedAt);
        if (!sent || added === null) return json(res, 400, { error: "send {server, addedAt}" });
        return answer(deps.sync.put(name, sent.server, added));
      }
      if (method === "DELETE") {
        const when = at(Number(url.searchParams.get("at")));
        return when === null ? json(res, 400, { error: "send ?at=" }) : answer(deps.sync.remove(name, when));
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (action === "sign-out" && method === "POST") {
      const when = at((await body() as { at?: unknown } | undefined)?.at);
      return when === null ? json(res, 400, { error: "send {at}" }) : answer(await deps.sync.signOut(name, when));
    }
    if (action === "lent" && method === "PUT") return answer(deps.sync.borrow(name, await body()));
    if (action === "sign-in" && method === "PUT") {
      const replaces = url.searchParams.get("replaces");
      if (replaces !== null && !DIGEST.test(replaces)) return json(res, 400, { error: "replaces is a sign-in's digest" });
      return answer(deps.sync.adopt(name, await body(), replaces));
    }
    // secrets out: only the person's own session on their own place
    if (!deps.owners(auth)) { req.resume(); return json(res, 404, { error: "not found" }); }
    if (action === "definition" && method === "GET") return answer(deps.sync.definition(name));
    if (action === "lend" && method === "POST") return answer(await deps.sync.lend(name));
    if (action === "take" && method === "POST") return answer(deps.sync.take(name));
    if (action === "release" && method === "POST") {
      const sent = await body() as { digest?: unknown; to?: unknown } | undefined;
      if (typeof sent?.digest !== "string" || !DIGEST.test(sent.digest) || typeof sent.to !== "string" || !sent.to || sent.to.length > 200) return json(res, 400, { error: "send {digest, to}" });
      return answer(deps.sync.release(name, sent.digest, sent.to));
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
