import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { CLAIM_TTL_MS, COMMAND_KINDS, COMMAND_TTL_MS, DASHBOARD_DISCOVERY_PATH, FAST_REPORT_MS, MAX_REPORT_BYTES, SIGNATURE_SKEW_MS, SLOW_REPORT_MS,
  freshnessOf, parseEnrollRequest, parseWorkspaceReport, signedPayload } from "../../../shared/dashboard-protocol.ts";
import type { CommandKind, CommandView, MachineSample, ReportAnswer, WorkspaceDetail, WorkspaceSummary } from "../../../shared/dashboard-protocol.ts";
import { AuthError, createAuth, isAppCorsRoute } from "./auth/index.ts";
import type { ProviderConfigs } from "./auth/providers.ts";
import type { Mailer } from "./auth/mail.ts";
import { createStore } from "./store.ts";
import type { Account, StoredWorkspace } from "./store.ts";
import { createBilling } from "./billing/index.ts";
import { BillingError } from "./billing/service.ts";
import { createSlackEdgeHost } from "./slack-edge/index.ts";
import { createBoatRoutes } from "./clouds/boat-routes.ts";
import { noticeText } from "./clouds/boat-retention.ts";
import type { EdgeSocketFactory } from "./slack-edge/service.ts";

export interface DashboardAppOptions {
  dataDir: string;
  publicUrl: string;
  mailer: Mailer;
  oauth?: ProviderConfigs;
  dev?: boolean;
  signupOpen?: boolean;
  trustProxy?: boolean;
  staticDir: string | null;
  now?: () => number;
  fetch?: typeof fetch;
  /** the slack wake edge: OMB_SLACK_EDGE and OMB_CLOUD_SEAL_KEY from env; tests pass a fake socket */
  slackEdge?: { env?: NodeJS.ProcessEnv; socket?: EdgeSocketFactory };
}
class RequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const random = (bytes: number) => randomBytes(bytes).toString("base64url");
const hourMs = 60 * 60_000;
const sections = ["machine", "computers", "bots", "activity", "devices", "plans"] as const;

export function createDashboardApp(options: DashboardAppOptions) {
  const now = options.now ?? Date.now;
  const publicUrl = new URL(options.publicUrl).origin;
  const store = createStore(options.dataDir);
  const state = store.state;
  const dev = options.dev ?? (new URL(publicUrl).protocol === "http:" && ["127.0.0.1", "localhost"].includes(new URL(publicUrl).hostname));
  const auth = createAuth({ dataDir: options.dataDir, publicUrl, mailer: options.mailer, now, fetch: options.fetch, oauth: options.oauth,
    dev, signupOpen: options.signupOpen ?? true, trustProxy: options.trustProxy ?? false, legacyAccounts: () => state.accounts });
  state.sessions = [];
  store.changed();
  auth.onSignedIn(owner => {
    const existing = state.accounts.find(item => item.id === owner.id);
    if (existing) existing.email = owner.email; else state.accounts.push({ id: owner.id, email: owner.email });
    store.changed();
  });
  auth.onAccountDeleted(id => {
    state.accounts = state.accounts.filter(item => item.id !== id);
    for (const ws of state.workspaces) if (ws.ownerAccountId === id) forget(ws);
    state.workspaces = state.workspaces.filter(ws => ws.ownerAccountId !== id);
    watching.delete(id);
    store.changed(); store.close();
  });
  let slackEdge: ReturnType<typeof createSlackEdgeHost> | null = null;
  const mail = (to: string | null | undefined, subject: string, text: string) => {
    if (!to) return;
    const html = `<p>${text.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]!)}</p>`;
    void options.mailer.send({ to, subject, text, html }).catch(() => console.warn("boat: a notice email failed"));
  };
  const billing = createBilling({ accountExists: id => auth.account(id) !== null,
    notify: (cloud, kind, at, link) => { const letter = noticeText(kind, { name: cloud.name, at, dashboardUrl: publicUrl, link }); mail(auth.account(cloud.accountId)?.email, letter.subject, letter.text); },
    alert: entry => mail(process.env.OMB_OPS_ALERT_EMAIL, `Boat ${entry.action}: cloud ${entry.cloudId}`, `${entry.action} by ${entry.actor} (${entry.reason}) at ${new Date(entry.at).toISOString()}`), dataDir: options.dataDir, publicUrl, dashboard: store, now, fetch: options.fetch, wakeStats: () => slackEdge?.edge.wakeStats() ?? {}, accounts: {
    fromCookie: req => { try { return account(req); } catch (error) { if (error instanceof AuthError && error.code === "signed_out") return null; throw error; } },
    fromBearer: req => auth.appSession(req)?.account ?? null } });
  auth.beforeAccountDelete(async (owner, body) => {
    try { await billing.beforeAccountDelete(owner, body); } catch (error) { if (error instanceof BillingError && error.code === "billing_active") throw new AuthError(409, "billing_active", { blockers: error.blockers }); throw error; }
  });
  slackEdge = createSlackEdgeHost({ dataDir: options.dataDir, clouds: billing.clouds, env: options.slackEdge?.env ?? process.env, now, socket: options.slackEdge?.socket,
    loopback: new URL(publicUrl).protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(publicUrl).hostname) });
  const edgeHost = slackEdge;
  auth.onAccountDeleted(id => edgeHost.edge.accountDeleted(billing.clouds.list(id, true).map(cloud => cloud.id)));
  auth.onAccountDeleted(id => billing.accountDeleted(id));
  auth.extendSession(async accountId => {
    const owner = auth.account(accountId);
    // the app session must survive a billing failure; it then reads as the free plan
    try { return owner && billing.enabled ? await billing.sessionFields(owner) : {}; } catch { console.warn("billing: session fields failed"); return {}; }
  });
  const boatRoutes = createBoatRoutes({ clouds: billing.clouds, publicUrl, now, json, readJson: async req => bodyObject(await readBody(req)),
    owner: req => {
      const owner = auth.requireWeb(req, { mutation: true }), found = auth.webSession(req);
      if (!found || found.account.id !== owner.id) throw new AuthError(401, "signed_out");
      return { id: owner.id, signedInAt: found.session.createdAt };
    } });
  const limits = new Map<string, { count: number; until: number }>();
  const watching = new Map<string, number>();
  const lastWatching = new Map<string, boolean>();
  const replays = new Map<string, number>();
  const commands = new Map<string, CommandView[]>();
  const history = new Map<string, MachineSample[]>();
  const waits = new Map<string, { finish: () => void; cancel: () => void }>();
  let closed = false;

  function json(res: ServerResponse, status: number, data: unknown) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  }
  function fail(status: number, code: string, message: string): never { throw new RequestError(status, code, message); }
  function cleanup() {
    const time = now();
    for (const [key, limit] of limits) if (limit.until <= time) limits.delete(key);
    for (const [signature, expiry] of replays) if (expiry < time) replays.delete(signature);
    for (const [id, until] of watching) if (until <= time) watching.delete(id);
    const workspaces = state.workspaces.filter(ws => ws.ownerAccountId !== null || time - ws.connectedAt < 24 * hourMs);
    if (workspaces.length !== state.workspaces.length) {
      for (const ws of state.workspaces) if (!workspaces.includes(ws)) forget(ws);
      state.workspaces = workspaces;
      store.changed();
    }
    for (const queue of commands.values()) for (const command of queue) {
      if ((command.status === "queued" || command.status === "sent") && command.expiresAt <= time) { command.status = "expired"; command.doneAt = time; }
    }
  }
  function rate(req: IncomingMessage, kind: string, max: number) {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = options.trustProxy && typeof forwarded === "string" ? forwarded.split(",")[0]!.trim() : req.socket.remoteAddress ?? "unknown";
    const key = `${kind}:${ip}`;
    const current = limits.get(key) ?? { count: 0, until: now() + hourMs };
    if (++current.count > max) fail(429, "rate_limited", "Try again later.");
    limits.set(key, current);
  }
  function account(req: IncomingMessage): Account {
    return auth.requireWeb(req, { mutation: ["POST", "PATCH", "DELETE"].includes(req.method ?? "GET") });
  }
  function summary(ws: StoredWorkspace): WorkspaceSummary {
    return { id: ws.id, name: ws.name, kind: ws.kind, version: ws.version, connectedAt: ws.connectedAt, lastReportAt: ws.lastReportAt, freshness: freshnessOf(ws.lastReportAt, now()) };
  }
  function isWatching(ws: StoredWorkspace) { return ws.ownerAccountId !== null && (watching.get(ws.ownerAccountId) ?? -Infinity) > now(); }
  function answer(ws: StoredWorkspace): ReportAnswer {
    cleanup();
    const watched = isWatching(ws);
    lastWatching.set(ws.id, watched);
    const queued = (commands.get(ws.id) ?? []).filter(command => command.status === "queued" && command.expiresAt > now());
    const delivery = queued.map(({ id, kind, target, issuedAt, expiresAt }) => ({ id, kind, target, issuedAt, expiresAt }));
    for (const command of queued) command.status = "sent";
    return { v: 1, watching: watched, nextReportMs: watched ? FAST_REPORT_MS : SLOW_REPORT_MS, commands: delivery };
  }
  function watch(owner: Account) {
    const wasWatching = (watching.get(owner.id) ?? -Infinity) > now();
    watching.set(owner.id, now() + 20_000);
    for (const ws of state.workspaces) if (ws.ownerAccountId === owner.id && (!wasWatching || !lastWatching.get(ws.id))) waits.get(ws.id)?.finish();
  }
  function forget(ws: StoredWorkspace) {
    waits.get(ws.id)?.cancel();
    commands.delete(ws.id);
    history.delete(ws.id);
    lastWatching.delete(ws.id);
  }
  function owned(id: string, owner: Account): StoredWorkspace {
    const ws = state.workspaces.find(item => item.id === id && item.ownerAccountId === owner.id);
    if (!ws) fail(404, "not_found", "Workspace not found.");
    return ws;
  }
  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_REPORT_BYTES) { req.resume(); fail(413, "too_large", "Request is too large."); }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }
  function bodyObject(body: Buffer): Record<string, unknown> {
    let value: unknown;
    try { value = JSON.parse(body.toString("utf8")); } catch { fail(400, "invalid_request", "Invalid JSON."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "invalid_request", "Invalid request.");
    return value as Record<string, unknown>;
  }
  function verifySignature(req: IncomingMessage, body: Buffer, publicKey: string) {
    const timeHeader = req.headers["x-omb-time"];
    const signature = req.headers["x-omb-signature"];
    const time = typeof timeHeader === "string" && /^\d{1,16}$/.test(timeHeader) ? Number(timeHeader) : NaN;
    if (!Number.isSafeInteger(time) || Math.abs(now() - time) > SIGNATURE_SKEW_MS) fail(401, "stale_time", "Request time is invalid.");
    if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) fail(401, "bad_signature", "Signature is invalid.");
    if (replays.has(signature)) fail(401, "replay", "Request was already received.");
    let valid = false;
    try {
      valid = verify(null, Buffer.from(signedPayload(req.method ?? "GET", req.url ?? "/", time, hash(body))),
        createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(signature, "base64"));
    } catch { valid = false; }
    if (!valid) fail(401, "bad_signature", "Signature is invalid.");
    replays.set(signature, time + SIGNATURE_SKEW_MS);
  }
  function signed(req: IncomingMessage, body: Buffer): StoredWorkspace {
    const id = req.headers["x-omb-workspace"];
    const ws = typeof id === "string" ? state.workspaces.find(item => item.id === id) : undefined;
    if (!ws) fail(401, "unknown_workspace", "Workspace is unknown.");
    verifySignature(req, body, ws.publicKey);
    return ws;
  }
  function staticPage(req: IncomingMessage, res: ServerResponse) {
    if (!options.staticDir) fail(404, "not_found", "Page not found.");
    let path: string;
    try { path = decodeURIComponent((req.url ?? "/").split("?")[0]!); } catch { fail(400, "invalid_path", "Invalid path."); }
    if (!path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some(part => part.startsWith("."))) fail(404, "not_found", "Page not found.");
    try {
      const root = realpathSync(options.staticDir).replace(/\/$/, "");
      let file = `${root}${path}`;
      try { if (!statSync(file).isFile()) file = `${root}/index.html`; } catch { file = `${root}/index.html`; }
      file = realpathSync(file);
      if (!file.startsWith(`${root}/`) || file.slice(root.length + 1).split("/").some(part => part.startsWith("."))) fail(404, "not_found", "Page not found.");
      const content = readFileSync(file);
      const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
      const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json" };
      res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream", "cache-control": ext === ".json" ? "no-store" : ext !== ".html" && path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
      res.end(content);
    } catch (error) {
      if (error instanceof RequestError) throw error;
      fail(404, "not_found", "Page not found.");
    }
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    if (closed) fail(503, "closed", "Service is closed.");
    cleanup();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", publicUrl);
    const path = url.pathname;
    const mutation = ["POST", "PATCH", "DELETE"].includes(method);
    const appleCallback = method === "POST" && path === "/v1/auth/oauth/apple/callback" && req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded";
    if (mutation && !isAppCorsRoute(path) && !appleCallback) {
      if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") fail(403, "forbidden", "JSON is required.");
      if (req.headers.origin !== undefined && req.headers.origin !== publicUrl) fail(403, "forbidden", "Origin is not allowed.");
    }
    if (await auth.handle(req, res, url, { readBody, bodyObject })) return;
    if (method === "GET" && path === DASHBOARD_DISCOVERY_PATH) return json(res, 200, { v: 1, url: publicUrl });
    if (await edgeHost.handle(req, res, url, { readBody, bodyObject, json, signed: (request, body) => signed(request, body),
      account: (request, mutation) => auth.requireWeb(request, { mutation }) })) return;
    if (await boatRoutes.handle(req, res, url)) return;
    if (await billing.handle(req, res, url)) return;
    if (!path.startsWith("/v1/") && !path.startsWith("/.well-known/")) {
      if (method === "GET") return staticPage(req, res);
      fail(404, "not_found", "Route not found.");
    }
    if (method === "POST" && path === "/v1/enroll") {
      rate(req, "enroll", 30);
      const body = await readBody(req), input = bodyObject(body);
      const data = parseEnrollRequest(input);
      if (input.enrollToken !== undefined && (typeof input.enrollToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.enrollToken))) fail(400, "invalid_request", "Invalid enrollment grant.");
      if (!data) fail(400, "invalid_request", "Invalid enrollment.");
      let publicKey: string;
      try {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.publicKey)) throw new Error();
        const der = Buffer.from(data.publicKey, "base64");
        const key = createPublicKey({ key: der, format: "der", type: "spki" });
        if (key.asymmetricKeyType !== "ed25519" || !key.export({ type: "spki", format: "der" }).equals(der)) throw new Error();
        publicKey = der.toString("base64");
      } catch { fail(400, "invalid_key", "Public key is invalid."); }
      let ownerAccountId: string | null = null;
      if (typeof input.enrollToken === "string") {
        verifySignature(req, body, publicKey);
        ownerAccountId = auth.consumeEnrollGrant(input.enrollToken);
        if (!ownerAccountId) fail(403, "invalid_grant", "Enrollment grant is invalid.");
      }
      let ws = state.workspaces.find(item => item.publicKey === publicKey);
      if (ws?.ownerAccountId && !ownerAccountId) return json(res, 200, { v: 1, workspaceId: ws.id, claimUrl: `${publicUrl}/?workspace=${ws.id}`, claimExpiresAt: 0, dashboardUrl: publicUrl });
      const token = random(24);
      if (!ws) {
        ws = { id: `ws_${random(16)}`, publicKey, ownerAccountId: null, claimHash: null, claimExpiresAt: 0, name: data.name, kind: data.kind,
          version: data.version, connectedAt: now(), lastReportAt: null, lastSeq: 0, lastSeqAt: 0, report: null, sectionAt: {} };
        state.workspaces.push(ws);
      }
      if (ownerAccountId) {
        // a new owner never inherits the previous owner's queued commands or open waits
        if (ws.ownerAccountId && ws.ownerAccountId !== ownerAccountId) forget(ws);
        ws.ownerAccountId = ownerAccountId;
        ws.claimHash = null;
        ws.claimExpiresAt = 0;
        store.changed();
        return json(res, 200, { v: 1, workspaceId: ws.id, claimUrl: `${publicUrl}/?workspace=${ws.id}`, claimExpiresAt: 0, dashboardUrl: publicUrl });
      }
      ws.claimHash = hash(token);
      ws.claimExpiresAt = now() + CLAIM_TTL_MS;
      store.changed();
      return json(res, 200, { v: 1, workspaceId: ws.id, claimUrl: `${publicUrl}/claim#${token}`, claimExpiresAt: ws.claimExpiresAt, dashboardUrl: publicUrl });
    }
    if ((method === "POST" && path === "/v1/report") || (method === "GET" && path === "/v1/wait")) {
      const body = await readBody(req);
      if (method === "GET" && body.length) fail(400, "invalid_request", "GET body must be empty.");
      const ws = signed(req, body);
      if (method === "POST") {
        const report = parseWorkspaceReport(bodyObject(body));
        if (!report) fail(400, "invalid_report", "Report is invalid.");
        if (report.seq <= ws.lastSeq && report.at - ws.lastSeqAt <= 10 * 60_000) fail(409, "old_sequence", "Report sequence is old.");
        ws.lastSeq = report.seq;
        ws.lastSeqAt = report.at;
        ws.lastReportAt = now();
        ws.kind = report.workspace.kind;
        ws.version = report.workspace.version;
        const previous = ws.report ?? { at: report.at, workspace: report.workspace };
        ws.report = { ...previous, at: report.at, workspace: report.workspace };
        for (const section of sections) if (report[section] !== undefined) {
          Object.assign(ws.report, { [section]: report[section] });
          ws.sectionAt[section] = report.at;
        }
        if (report.machine) {
          const machine = report.machine;
          const samples = history.get(ws.id) ?? [];
          samples.push({ t: report.at, cpu: machine.cpu.percent, mem: machine.memory.totalBytes > 0 ? Math.min(100, machine.memory.usedBytes / machine.memory.totalBytes * 100) : 0,
            rx: machine.network?.rxBytesPerSec ?? 0, tx: machine.network?.txBytesPerSec ?? 0 });
          history.set(ws.id, samples.slice(-240));
        }
        for (const result of report.results ?? []) {
          const command = commands.get(ws.id)?.find(item => item.id === result.id && (item.status === "queued" || item.status === "sent"));
          if (command) { command.status = result.ok ? "done" : "failed"; command.message = result.message; command.doneAt = result.at; }
        }
        store.changed();
        return json(res, 200, answer(ws));
      }
      const seconds = Number(url.searchParams.get("wait") ?? "25");
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30) fail(400, "invalid_wait", "Wait must be 1 to 30 seconds.");
      waits.get(ws.id)?.finish();
      if ((commands.get(ws.id) ?? []).some(command => command.status === "queued") || (isWatching(ws) && !lastWatching.get(ws.id))) return json(res, 200, answer(ws));
      let timer: ReturnType<typeof setTimeout>;
      const clear = () => { clearTimeout(timer); waits.delete(ws.id); res.off("close", clear); };
      const finish = () => { clear(); json(res, 200, answer(ws)); };
      const cancel = () => { clear(); json(res, 401, { error: "Workspace is unknown.", code: "unknown_workspace" }); };
      timer = setTimeout(finish, seconds * 1000);
      waits.set(ws.id, { finish, cancel });
      res.on("close", clear);
      return;
    }
    if (method === "GET" && path === "/v1/workspaces") {
      const owner = account(req);
      watch(owner);
      return json(res, 200, { workspaces: state.workspaces.filter(ws => ws.ownerAccountId === owner.id).map(summary) });
    }
    if (method === "POST" && path === "/v1/claim") {
      const owner = account(req);
      const data = bodyObject(await readBody(req));
      if (typeof data.token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(data.token)) fail(404, "invalid_claim", "Claim link is invalid or expired.");
      const digest = Buffer.from(hash(data.token), "hex");
      const ws = state.workspaces.find(item => item.ownerAccountId === null && item.claimHash !== null && item.claimExpiresAt > now() && timingSafeEqual(Buffer.from(item.claimHash, "hex"), digest));
      if (!ws) fail(404, "invalid_claim", "Claim link is invalid or expired.");
      ws.ownerAccountId = owner.id;
      ws.claimHash = null;
      ws.claimExpiresAt = 0;
      store.changed();
      return json(res, 200, { workspace: summary(ws) });
    }
    const match = /^\/v1\/workspaces\/([^/]+)(\/commands)?$/.exec(path);
    if (match) {
      const owner = account(req);
      const ws = owned(match[1]!, owner);
      if (!match[2] && method === "GET") {
        watch(owner);
        const detail: WorkspaceDetail = { workspace: summary(ws), report: ws.report, sectionAt: ws.sectionAt, history: history.get(ws.id) ?? [], commands: commands.get(ws.id) ?? [] };
        return json(res, 200, detail);
      }
      if (match[2] && method === "POST") {
        const data = bodyObject(await readBody(req));
        if (!COMMAND_KINDS.includes(data.kind as CommandKind) || typeof data.target !== "string" || !data.target.length || data.target.length > 200) fail(400, "invalid_command", "Command is invalid.");
        const queue = commands.get(ws.id) ?? [];
        if (queue.filter(item => item.status === "queued" || item.status === "sent").length >= 200) fail(429, "rate_limited", "Too many pending commands.");
        const command: CommandView = { id: `cmd_${random(16)}`, kind: data.kind as CommandKind, target: data.target, issuedAt: now(), expiresAt: now() + COMMAND_TTL_MS, status: "queued", message: null, doneAt: null };
        queue.push(command);
        commands.set(ws.id, queue.filter(item => item.status === "queued" || item.status === "sent" || queue.indexOf(item) >= queue.length - 100));
        const view = { ...command };
        waits.get(ws.id)?.finish();
        return json(res, 200, { command: view });
      }
      if (!match[2] && method === "PATCH") {
        const data = bodyObject(await readBody(req));
        if (typeof data.name !== "string" || !data.name.trim().length || data.name.length > 60) fail(400, "invalid_name", "Name must be 1 to 60 characters.");
        ws.name = data.name.trim();
        store.changed();
        return json(res, 200, { workspace: summary(ws) });
      }
      if (!match[2] && method === "DELETE") {
        forget(ws);
        state.workspaces = state.workspaces.filter(item => item !== ws);
        store.changed();
        return json(res, 200, { ok: true });
      }
    }
    fail(404, "not_found", "Route not found.");
  }
  return {
    auth,
    slackEdge: edgeHost,
    handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      return route(req, res).catch(error => {
        if (error instanceof RequestError || error instanceof AuthError) json(res, error.status, req.url?.startsWith("/api/cloud/") ? { error: error.code } : { error: error.message, code: error.code });
        else json(res, 500, req.url?.startsWith("/api/cloud/") ? { error: "failed" } : { error: "Request failed.", code: "failed" });
      });
    },
    close() {
      edgeHost.close();
      billing.close();
      closed = true;
      for (const wait of Array.from(waits.values())) wait.cancel();
      auth.close();
      store.close();
    },
  };
}
