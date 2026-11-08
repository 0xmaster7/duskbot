import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

export interface FakeSlackOptions {
  configToken?: string;
  refreshToken?: string;
  configTtlSeconds?: number;
}
export interface FakeSlackCall {
  method: string;
  token: string | null;
  params: Record<string, string>;
  files?: Array<{ field: string; name: string; type: string; size: number }>;
  at: number;
}
export interface FakeSlackManifest {
  features?: { bot_user?: { display_name?: string } };
  oauth_config?: { redirect_urls?: string[]; scopes?: { bot?: string[] } };
  settings?: { socket_mode_enabled?: boolean };
  [key: string]: unknown;
}
export interface FakeSlackApp {
  appId: string;
  manifest: FakeSlackManifest;
  credentials: { client_id: string; client_secret: string; verification_token: string; signing_secret: string };
  deleted?: boolean;
}
export interface FakeSlackUser {
  id: string;
  name: string;
  real_name?: string;
  is_bot?: boolean;
  profile?: { email?: string; display_name?: string; real_name?: string };
}
export interface FakeSlackChannel {
  id: string;
  name?: string;
  is_private?: boolean;
  is_member?: boolean;
  is_im?: boolean;
}
export interface FakeSlackMessage {
  ts: string;
  text: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  [key: string]: unknown;
}
export interface FakeSlackFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
  url_private_download: string;
}
export interface FakeSlackPost { appId: string; channel: string; text: string; thread_ts?: string; ts: string }
export interface FakeSlackReaction { op: "add" | "remove"; appId: string; channel: string; timestamp: string; name: string }
export interface FakeSlackAck { envelopeId: string; ms: number; at: number }
export interface FakeSlack {
  url: string;
  calls: FakeSlackCall[];
  callsTo(method: string): FakeSlackCall[];
  fail(method: string, error: string, times?: number): void;
  rateLimit(method: string, retryAfterSeconds: number, times?: number): void;
  delay(method: string, ms: number): void;
  config: { readonly access: string; readonly refresh: string; readonly rotations: number };
  expireConfigToken(): void;
  apps: Map<string, FakeSlackApp>;
  icons: Array<{ appId: string; bytes: Buffer; mime: string }>;
  mintCode(appId: string): string;
  mintAppToken(appId: string): string;
  revokeAppToken(token: string): void;
  socket: {
    connections(appId: string): number;
    waitForConnection(appId: string, timeoutMs?: number): Promise<void>;
    waitForConnections(appId: string, n: number, timeoutMs?: number): Promise<void>;
    event(appId: string, event: Record<string, unknown>, opts?: { retryAttempt?: number; envelopeId?: string; eventId?: string }): string;
    waitForAck(envelopeId: string, timeoutMs?: number): Promise<{ ms: number }>;
    acks: FakeSlackAck[];
    disconnect(appId: string, reason: string): void;
    drop(appId: string): void;
  };
  posted: FakeSlackPost[];
  updated: FakeSlackPost[];
  waitForPost(predicate: (post: FakeSlackPost) => boolean, timeoutMs?: number): Promise<FakeSlackPost>;
  reactions: FakeSlackReaction[];
  waitForReaction(predicate: (reaction: FakeSlackReaction) => boolean, timeoutMs?: number): Promise<FakeSlackReaction>;
  users: Map<string, FakeSlackUser>;
  addUser(user: FakeSlackUser): void;
  channels: Map<string, FakeSlackChannel>;
  addChannel(channel: FakeSlackChannel): void;
  seedMessages(channel: string, messages: FakeSlackMessage[]): void;
  addFile(file: { name: string; mime: string; bytes: Uint8Array }): FakeSlackFile;
  downloads: Array<{ fileId: string; token: string }>;
  uploads: Array<{ fileId: string; filename: string; bytes: Buffer; authorization: string | null }>;
  completed: Array<{ appId: string; files: Array<{ id: string; title?: string }>; channel_id: string; thread_ts?: string; initial_comment?: string }>;
  close(): Promise<void>;
}

type ParsedFile = { field: string; name: string; type: string; size: number; bytes: Buffer };
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const refused = (error: string) => ({ ok: false, error });
const json = (res: ServerResponse, body: unknown, status = 200) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function parseBody(req: IncomingMessage) {
  const body = await readBody(req);
  const header = req.headers["content-type"] ?? "";
  const params: Record<string, string> = {};
  const files: ParsedFile[] = [];
  if (header.startsWith("multipart/form-data")) {
    const form = await new Response(body, { headers: { "content-type": header } }).formData();
    for (const [field, value] of form) {
      if (typeof value === "string") params[field] = value;
      else files.push({ field, name: value.name, type: value.type, size: value.size, bytes: Buffer.from(await value.arrayBuffer()) });
    }
  } else if (header.startsWith("application/json")) {
    for (const [key, value] of Object.entries(JSON.parse(body.toString()))) {
      params[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  } else {
    for (const [key, value] of new URLSearchParams(body.toString())) params[key] = value;
  }
  return { params, files };
}

export async function startFakeSlack(options: FakeSlackOptions = {}): Promise<FakeSlack> {
  let access = options.configToken ?? "xoxe.xoxp-1-fake-initial-access";
  let refresh = options.refreshToken ?? "xoxe-1-fake-initial-refresh";
  let rotations = 0;
  let expiresAt = Date.now() + (options.configTtlSeconds ?? 43200) * 1000;
  let appSequence = 0, codeSequence = 0, fileSequence = 0, postSequence = 0;
  let url = "", closed = false;
  const team = { id: "T0FAKE", name: "Fake Team", domain: "fake-team" };
  const apps = new Map<string, FakeSlackApp>();
  const bots = new Map<string, { appId: string; userId: string; botId: string }>();
  const codes = new Map<string, string>(), appTokens = new Map<string, string>(), tickets = new Map<string, string>();
  const connections = new Map<string, WebSocket[]>();
  const sent = new Map<string, number>();
  const failures = new Map<string, Array<{ error: string; retryAfter?: number }>>();
  const delays = new Map<string, number>();
  const users = new Map<string, FakeSlackUser>();
  const channels = new Map<string, FakeSlackChannel>();
  const messages = new Map<string, FakeSlackMessage[]>();
  const fileData = new Map<string, { file: FakeSlackFile; bytes: Buffer }>();
  const uploadNames = new Map<string, string>();
  const reactionKeys = new Set<string>();
  const calls: FakeSlackCall[] = [], posted: FakeSlackPost[] = [], updated: FakeSlackPost[] = [];
  const icons: FakeSlack["icons"] = [], reactions: FakeSlackReaction[] = [], acks: FakeSlackAck[] = [];
  const downloads: FakeSlack["downloads"] = [], uploads: FakeSlack["uploads"] = [], completed: FakeSlack["completed"] = [];
  const waiters = new Set<{ check(): void; stop(): void }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const notify = () => { for (const waiter of Array.from(waiters)) waiter.check(); };
  function waitFor<T>(read: () => T | undefined, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (value?: T, error?: Error) => {
        clearTimeout(timer);
        waiters.delete(waiter);
        if (error) reject(error); else resolve(value as T);
      };
      const waiter = {
        check: () => {
          try { const value = read(); if (value !== undefined) finish(value); }
          catch { finish(undefined, new Error("Fake Slack predicate failed")); }
        },
        stop: () => finish(undefined, new Error("Fake Slack closed")),
      };
      timer = setTimeout(() => finish(undefined, new Error("Fake Slack wait timed out")), timeoutMs);
      waiters.add(waiter);
      if (closed) waiter.stop(); else waiter.check();
    });
  }
  const live = (appId: string) => (connections.get(appId) ?? []).filter((ws) => ws.readyState === WebSocket.OPEN);
  const requireApp = (appId: string) => {
    const app = apps.get(appId);
    if (!app) throw new Error("Fake Slack app not found");
    return app;
  };
  const validConfig = (token: string | null) => token === access && Date.now() < expiresAt;
  const inject = (method: string, failure: { error: string; retryAfter?: number }, times: number) => {
    const queue = failures.get(method) ?? [];
    for (let i = 0; i < times; i++) queue.push(failure);
    failures.set(method, queue);
  };
  for (const [id, name, realName] of [["U0ALICE", "alice", "Alice Example"], ["U0BOB", "bob", "Bob Example"]]) {
    users.set(id, { id, name, real_name: realName, is_bot: false,
      profile: { email: `${name}@example.test`, display_name: realName.split(" ")[0], real_name: realName } });
  }
  channels.set("C0GENERAL", { id: "C0GENERAL", name: "general", is_private: false, is_member: true, is_im: false });
  channels.set("C0PRIVATE", { id: "C0PRIVATE", name: "secret-room", is_private: true, is_member: true, is_im: false });

  function api(method: string, token: string | null, p: Record<string, string>, files: ParsedFile[]): unknown {
    if (method === "tooling.tokens.rotate") {
      if (p.refresh_token !== refresh) return refused("invalid_refresh_token");
      rotations++;
      access = `xoxe.xoxp-1-fake-access-${rotations}`;
      refresh = `xoxe-1-fake-refresh-${rotations}`;
      const iat = Math.floor(Date.now() / 1000), exp = iat + (options.configTtlSeconds ?? 43200);
      expiresAt = exp * 1000;
      return { ok: true, token: access, refresh_token: refresh, team_id: team.id, user_id: "U0OWNER", iat, exp };
    }
    if (method === "oauth.v2.access") {
      const app = [...apps.values()].find((a) => a.credentials.client_id === p.client_id);
      if (!app || app.credentials.client_secret !== p.client_secret) return refused("invalid_client_id");
      if (!codes.has(p.code) || codes.get(p.code) !== app.appId) return refused("invalid_code");
      if (!p.redirect_uri || p.redirect_uri !== app.manifest.oauth_config?.redirect_urls?.[0]) return refused("bad_redirect_uri");
      codes.delete(p.code);
      const n = app.appId.slice("A0FAKE".length), userId = `U0BOT${n}`, botId = `B0BOT${n}`;
      const token = `xoxb-fake-${app.appId}-${hex(8)}`;
      bots.set(token, { appId: app.appId, userId, botId });
      const displayName = app.manifest.features?.bot_user?.display_name ?? "Fake Bot";
      users.set(userId, { id: userId, name: displayName.toLowerCase().replace(/\s+/g, "-"), is_bot: true, profile: { display_name: displayName } });
      return { ok: true, access_token: token, token_type: "bot", scope: (app.manifest.oauth_config?.scopes?.bot ?? []).join(","),
        bot_user_id: userId, app_id: app.appId, team: { id: team.id, name: team.name } };
    }
    if (method === "auth.test") {
      const base = { ok: true, team: team.name, team_id: team.id, url: "https://fake-team.slack.com/" };
      if (validConfig(token)) return { ...base, user_id: "U0OWNER" };
      const bot = bots.get(token ?? "");
      return bot ? { ...base, user_id: bot.userId, bot_id: bot.botId, app_id: bot.appId } : refused(token ? "invalid_auth" : "not_authed");
    }
    if (["apps.manifest.create", "apps.manifest.update", "apps.manifest.delete", "apps.icon.set"].includes(method)) {
      if (!validConfig(token)) return refused(token ? "invalid_auth" : "not_authed");
      if (method !== "apps.manifest.create" && !apps.has(p.app_id)) return refused("app_not_found");
      if (method === "apps.manifest.delete") { apps.delete(p.app_id); return { ok: true }; }
      if (method === "apps.icon.set") {
        const image = files.find((file) => file.field === "image");
        if (!image) return refused("invalid_arguments");
        icons.push({ appId: p.app_id, bytes: image.bytes, mime: image.type });
        return { ok: true };
      }
      let manifest: FakeSlackManifest;
      try {
        manifest = JSON.parse(p.manifest);
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return refused("invalid_manifest");
      } catch { return refused("invalid_manifest"); }
      if (method === "apps.manifest.update") {
        apps.get(p.app_id)!.manifest = manifest;
        return { ok: true, app_id: p.app_id, permissions_updated: true };
      }
      const n = ++appSequence, appId = `A0FAKE${n}`;
      const credentials = { client_id: `1000.${n}`, client_secret: `fake-client-secret-${n}-${hex(6)}`,
        verification_token: `fake-verification-${n}-${hex(6)}`, signing_secret: `fake-signing-secret-${n}-${hex(6)}` };
      apps.set(appId, { appId, manifest, credentials });
      return { ok: true, app_id: appId, credentials, oauth_authorize_url: `https://slack.com/oauth/v2/authorize?client_id=${credentials.client_id}` };
    }
    if (method === "apps.connections.open") {
      const appId = appTokens.get(token ?? "");
      if (!appId || !apps.get(appId)?.manifest.settings?.socket_mode_enabled) return refused(token ? "invalid_auth" : "not_authed");
      const ticket = hex(12);
      tickets.set(ticket, appId);
      return { ok: true, url: `${url.replace("http:", "ws:")}/link/?ticket=${ticket}&app=${appId}` };
    }
    const known = ["auth.revoke", "chat.postMessage", "chat.update", "reactions.add", "reactions.remove", "users.info", "users.lookupByEmail",
      "conversations.list", "conversations.info", "conversations.open", "conversations.history", "conversations.replies",
      "files.getUploadURLExternal", "files.completeUploadExternal"];
    if (!known.includes(method)) return refused("unknown_method");
    const bot = bots.get(token ?? "");
    if (!bot) return refused(token ? "invalid_auth" : "not_authed");
    if (method === "auth.revoke") { bots.delete(token!); return { ok: true, revoked: true }; }
    if (method === "chat.postMessage" || method === "chat.update") {
      const micros = (postSequence + 1) * 100;
      const ts = method === "chat.update" ? p.ts : `${1700000100 + Math.floor(micros / 1000000)}.${String(micros % 1000000).padStart(6, "0")}`;
      if (method === "chat.postMessage") postSequence++;
      const post = { appId: bot.appId, channel: p.channel, text: p.text, ...(p.thread_ts ? { thread_ts: p.thread_ts } : {}), ts };
      (method === "chat.postMessage" ? posted : updated).push(post);
      const message = { text: p.text, ts, user: bot.userId, bot_id: bot.botId, ...(p.thread_ts ? { thread_ts: p.thread_ts } : {}) };
      const history = messages.get(p.channel) ?? [];
      const existing = history.findIndex((entry) => entry.ts === ts);
      if (existing >= 0) history[existing] = { ...history[existing], ...message }; else history.push(message);
      messages.set(p.channel, history);
      notify();
      return { ok: true, channel: p.channel, ts, message };
    }
    if (method.startsWith("reactions.")) {
      const op = method === "reactions.add" ? "add" : "remove";
      const reaction = { op, appId: bot.appId, channel: p.channel, timestamp: p.timestamp, name: p.name } as FakeSlackReaction;
      reactions.push(reaction);
      const key = JSON.stringify([bot.appId, p.channel, p.timestamp, p.name]);
      const exists = reactionKeys.has(key);
      if (op === "add") reactionKeys.add(key); else reactionKeys.delete(key);
      notify();
      return exists === (op === "add") ? refused(op === "add" ? "already_reacted" : "no_reaction") : { ok: true };
    }
    if (method.startsWith("users.")) {
      const user = method === "users.info" ? users.get(p.user) : [...users.values()].find((user) => user.profile?.email === p.email);
      return user ? { ok: true, user } : refused(method === "users.info" ? "user_not_found" : "users_not_found");
    }
    const limit = Math.max(1, Math.floor(Number(p.limit) || 100));
    if (method === "conversations.list") {
      const start = Math.max(0, Number(p.cursor) || 0);
      const all = [...channels.values()].filter((c) => !c.is_im && (!p.types || p.types.split(",").includes(c.is_private ? "private_channel" : "public_channel")));
      return { ok: true, channels: all.slice(start, start + limit), response_metadata: { next_cursor: start + limit < all.length ? String(start + limit) : "" } };
    }
    if (method === "conversations.info") return channels.has(p.channel) ? { ok: true, channel: channels.get(p.channel) } : refused("channel_not_found");
    if (method === "conversations.open") {
      const id = `D${p.users.slice(1)}`;
      channels.set(id, { id, is_im: true });
      return { ok: true, channel: { id } };
    }
    if (method === "conversations.history" || method === "conversations.replies") {
      const history = [...(messages.get(p.channel) ?? [])];
      const selected = method === "conversations.replies"
        ? history.filter((m) => m.ts === p.ts || m.thread_ts === p.ts).sort((a, b) => Number(a.ts) - Number(b.ts))
        : history.filter((m) => !p.latest || Number(m.ts) < Number(p.latest)).sort((a, b) => Number(b.ts) - Number(a.ts));
      return { ok: true, messages: selected.slice(0, limit), has_more: selected.length > limit };
    }
    if (method === "files.getUploadURLExternal") {
      const id = `F0FAKE${++fileSequence}`;
      uploadNames.set(id, p.filename);
      return { ok: true, upload_url: `${url}/upload/v1/${id}`, file_id: id };
    }
    if (method === "files.completeUploadExternal") {
      let files: Array<{ id: string; title?: string }>;
      try { files = JSON.parse(p.files); if (!Array.isArray(files)) return refused("invalid_arguments"); }
      catch { return refused("invalid_arguments"); }
      completed.push({ appId: bot.appId, files, channel_id: p.channel_id,
        ...(p.thread_ts ? { thread_ts: p.thread_ts } : {}), ...(p.initial_comment ? { initial_comment: p.initial_comment } : {}) });
      return { ok: true, files };
    }
    return refused("unknown_method");
  }

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", url).pathname;
      const authorization = req.headers.authorization ?? null;
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
      if (req.method === "GET" && path.startsWith("/files-pri/")) {
        if (!token || !bots.has(token)) { res.writeHead(403).end(); return; }
        const entry = [...fileData.values()].find(({ file }) => new URL(file.url_private).pathname === path);
        if (!entry) { res.writeHead(404).end(); return; }
        downloads.push({ fileId: entry.file.id, token });
        res.writeHead(200, { "content-type": entry.file.mimetype, "content-length": entry.bytes.length }).end(entry.bytes);
        return;
      }
      if (req.method === "POST" && path.startsWith("/upload/v1/")) {
        const fileId = path.slice("/upload/v1/".length), filename = uploadNames.get(fileId);
        if (filename === undefined) { res.writeHead(404).end(); return; }
        uploads.push({ fileId, filename, bytes: await readBody(req), authorization });
        res.writeHead(200).end("OK");
        return;
      }
      if (req.method !== "POST" || !path.startsWith("/api/")) { res.writeHead(404).end(); return; }
      const method = path.slice("/api/".length), { params, files } = await parseBody(req);
      calls.push({ method, token, params, ...(files.length ? { files: files.map(({ field, name, type, size }) => ({ field, name, type, size })) } : {}), at: Date.now() });
      const delay = delays.get(method);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const failure = failures.get(method)?.shift();
      if (failure) {
        if (failure.retryAfter !== undefined) res.setHeader("Retry-After", String(failure.retryAfter));
        json(res, refused(failure.error), failure.retryAfter === undefined ? 200 : 429);
        return;
      }
      json(res, api(method, token, params, files));
    })().catch(() => { if (!res.headersSent) json(res, refused("invalid_arguments"), 400); else res.end(); });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const link = new URL(req.url ?? "/", url), ticket = link.searchParams.get("ticket") ?? "";
    const appId = tickets.get(ticket);
    if (link.pathname !== "/link/" || !appId || link.searchParams.get("app") !== appId || !apps.has(appId)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    tickets.delete(ticket);
    wss.handleUpgrade(req, socket, head, (ws) => {
      connections.set(appId, [...(connections.get(appId) ?? []), ws]);
      ws.on("error", () => {});
      ws.on("close", () => {
        connections.set(appId, (connections.get(appId) ?? []).filter((entry) => entry !== ws));
        notify();
      });
      ws.on("message", (data) => {
        try {
          const { envelope_id } = JSON.parse(data.toString());
          const start = sent.get(envelope_id);
          if (typeof envelope_id === "string" && start !== undefined) {
            acks.push({ envelopeId: envelope_id, ms: performance.now() - start, at: Date.now() });
            notify();
          }
        } catch {}
      });
      ws.send(JSON.stringify({ type: "hello", num_connections: live(appId).length, debug_info: { host: "fake" }, connection_info: { app_id: appId } }));
      notify();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, calls, callsTo: (method) => calls.filter((call) => call.method === method),
    fail: (method, error, times = 1) => inject(method, { error }, times),
    rateLimit: (method, retryAfter, times = 1) => inject(method, { error: "ratelimited", retryAfter }, times),
    delay: (method, ms) => { delays.set(method, ms); },
    config: { get access() { return access; }, get refresh() { return refresh; }, get rotations() { return rotations; } },
    expireConfigToken: () => { expiresAt = 0; }, apps, icons,
    mintCode: (appId) => { requireApp(appId); const code = `fake-code-${++codeSequence}-${hex(4)}`; codes.set(code, appId); return code; },
    mintAppToken: (appId) => { requireApp(appId); const token = `xapp-1-${appId}-fake-${hex(12)}`; appTokens.set(token, appId); return token; },
    revokeAppToken: (token) => { appTokens.delete(token); },
    socket: {
      connections: (appId) => live(appId).length,
      waitForConnection: async (appId, timeoutMs) => { await waitFor(() => live(appId).length > 0 ? true : undefined, timeoutMs); },
      waitForConnections: async (appId, n, timeoutMs) => { await waitFor(() => live(appId).length >= n ? true : undefined, timeoutMs); },
      acks,
      event: (appId, event, opts = {}) => {
        const ws = live(appId).at(-1);
        if (!ws) throw new Error("Fake Slack has no connection");
        const envelopeId = opts.envelopeId ?? `fake-envelope-${hex(8)}`;
        sent.set(envelopeId, performance.now());
        ws.send(JSON.stringify({ envelope_id: envelopeId, type: "events_api", accepts_response_payload: false,
          retry_attempt: opts.retryAttempt ?? 0, ...(opts.retryAttempt ? { retry_reason: "timeout" } : {}),
          payload: { token: "fake", team_id: team.id, api_app_id: appId, event, type: "event_callback",
            event_id: opts.eventId ?? `Ev${hex(8)}`, event_time: Math.floor(Date.now() / 1000) } }));
        return envelopeId;
      },
      waitForAck: async (id, timeoutMs) => { const ack = await waitFor(() => acks.find((ack) => ack.envelopeId === id), timeoutMs); return { ms: ack.ms }; },
      disconnect: (appId, reason) => {
        const sockets = live(appId);
        for (const ws of sockets) ws.send(JSON.stringify({ type: "disconnect", reason }));
        const timer = setTimeout(() => { timers.delete(timer); for (const ws of sockets) ws.close(); }, 100);
        timers.add(timer);
      },
      drop: (appId) => { for (const ws of live(appId)) ws.terminate(); },
    },
    posted, updated, waitForPost: (predicate, timeoutMs) => waitFor(() => posted.find(predicate), timeoutMs),
    reactions, waitForReaction: (predicate, timeoutMs) => waitFor(() => reactions.find(predicate), timeoutMs),
    users, addUser: (user) => { users.set(user.id, user); },
    channels, addChannel: (channel) => { channels.set(channel.id, channel); },
    seedMessages: (channel, history) => { messages.set(channel, [...history]); },
    addFile: ({ name, mime, bytes }) => {
      const id = `F0FAKE${++fileSequence}`, fileUrl = `${url}/files-pri/${team.id}-${id}/${encodeURIComponent(name)}`;
      const file = { id, name, mimetype: mime, size: bytes.byteLength, url_private: fileUrl, url_private_download: fileUrl };
      fileData.set(id, { file, bytes: Buffer.from(bytes) });
      return file;
    },
    downloads, uploads, completed,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const waiter of Array.from(waiters)) waiter.stop();
      for (const timer of timers) clearTimeout(timer);
      for (const ws of wss.clients) ws.terminate();
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
      ]);
    },
  };
}
