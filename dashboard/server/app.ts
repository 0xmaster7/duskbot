import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { CLAIM_TTL_MS, COMMAND_KINDS, COMMAND_TTL_MS, DASHBOARD_DISCOVERY_PATH, FAST_REPORT_MS, MAX_REPORT_BYTES, SIGNATURE_SKEW_MS, SLOW_REPORT_MS,
  freshnessOf, parseEnrollRequest, parseWorkspaceReport, signedPayload } from "../../shared/dashboard-protocol.ts";
import type { CommandKind, CommandView, MachineSample, ReportAnswer, WorkspaceDetail, WorkspaceSummary } from "../../shared/dashboard-protocol.ts";
import { AccountError, cleanEmail, createAccountProxy } from "./account.ts";
import { createStore } from "./store.ts";
import type { Account, StoredWorkspace } from "./store.ts";

export interface DashboardAppOptions {
  dataDir: string;
  publicUrl: string;
  accountOrigin: string;
  staticDir: string | null;
  now?: () => number;
  fetch?: typeof fetch;
}
class RequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const random = (bytes: number) => randomBytes(bytes).toString("base64url");
const sessionMs = 30 * 24 * 60 * 60_000;
const hourMs = 60 * 60_000;
const sections = ["machine", "computers", "bots", "activity", "devices", "plans"] as const;

export function createDashboardApp(options: DashboardAppOptions) {
  const now = options.now ?? Date.now;
  const publicUrl = new URL(options.publicUrl).origin;
  const secure = publicUrl.startsWith("https:");
  const store = createStore(options.dataDir);
  const state = store.state;
  const accountProxy = createAccountProxy(options.accountOrigin, options.fetch, now);
  const attempts = new Map<string, { admin: string; expiresAt: number; busy: boolean }>();
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
    for (const [id, attempt] of attempts) if (attempt.expiresAt <= time && !attempt.busy) attempts.delete(id);
    for (const [key, limit] of limits) if (limit.until <= time) limits.delete(key);
    for (const [signature, expiry] of replays) if (expiry < time) replays.delete(signature);
    for (const [id, until] of watching) if (until <= time) watching.delete(id);
    const sessions = state.sessions.filter(session => session.expiresAt > time);
    const workspaces = state.workspaces.filter(ws => ws.ownerAccountId !== null || time - ws.connectedAt < 24 * hourMs);
    if (sessions.length !== state.sessions.length || workspaces.length !== state.workspaces.length) {
      state.sessions = sessions;
      for (const ws of state.workspaces) if (!workspaces.includes(ws)) forget(ws);
      state.workspaces = workspaces;
      store.changed();
    }
    for (const queue of commands.values()) for (const command of queue) {
      if ((command.status === "queued" || command.status === "sent") && command.expiresAt <= time) { command.status = "expired"; command.doneAt = time; }
    }
  }
  function rate(req: IncomingMessage, kind: string, max: number) {
    const key = `${kind}:${req.socket.remoteAddress ?? "unknown"}`;
    const current = limits.get(key) ?? { count: 0, until: now() + hourMs };
    if (++current.count > max) fail(429, "rate_limited", "Try again later.");
    limits.set(key, current);
  }
  function account(req: IncomingMessage): Account {
    const token = req.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith("omb_dash="))?.slice(9);
    const session = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? state.sessions.find(item => item.hash === hash(token) && item.expiresAt > now()) : undefined;
    const found = session && state.accounts.find(item => item.id === session.accountId);
    if (!found) fail(401, "signed_out", "Sign in to continue.");
    return found;
  }
  function cookie(token: string, maxAge: number) { return `omb_dash=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`; }
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
  function signed(req: IncomingMessage, body: Buffer): StoredWorkspace {
    const id = req.headers["x-omb-workspace"];
    const timeHeader = req.headers["x-omb-time"];
    const signature = req.headers["x-omb-signature"];
    const time = typeof timeHeader === "string" && /^\d{1,16}$/.test(timeHeader) ? Number(timeHeader) : NaN;
    if (!Number.isSafeInteger(time) || Math.abs(now() - time) > SIGNATURE_SKEW_MS) fail(401, "stale_time", "Request time is invalid.");
    const ws = typeof id === "string" ? state.workspaces.find(item => item.id === id) : undefined;
    if (!ws) fail(401, "unknown_workspace", "Workspace is unknown.");
    if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) fail(401, "bad_signature", "Signature is invalid.");
    if (replays.has(signature)) fail(401, "replay", "Request was already received.");
    let valid = false;
    try {
      valid = verify(null, Buffer.from(signedPayload(req.method ?? "GET", req.url ?? "/", time, hash(body))),
        createPublicKey({ key: Buffer.from(ws.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(signature, "base64"));
    } catch { valid = false; }
    if (!valid) fail(401, "bad_signature", "Signature is invalid.");
    replays.set(signature, time + SIGNATURE_SKEW_MS);
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
    if (mutation) {
      if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") fail(403, "forbidden", "JSON is required.");
      if (req.headers.origin !== undefined && req.headers.origin !== publicUrl) fail(403, "forbidden", "Origin is not allowed.");
    }
    if (method === "GET" && path === DASHBOARD_DISCOVERY_PATH) return json(res, 200, { v: 1, url: publicUrl });
    if (!path.startsWith("/v1/") && !path.startsWith("/.well-known/")) {
      if (method === "GET") return staticPage(req, res);
      fail(404, "not_found", "Route not found.");
    }
    if (method === "POST" && path === "/v1/auth/start") {
      rate(req, "start", 20);
      const data = bodyObject(await readBody(req));
      const email = cleanEmail(data.email);
      if (!email) fail(400, "failed", "Enter a valid email address.");
      const result = await accountProxy.start(email);
      const attempt = random(32);
      attempts.set(attempt, { admin: result.attempt, expiresAt: now() + hourMs, busy: false });
      return json(res, 200, { attempt, resendAfter: result.resendAfter, expiresIn: result.expiresIn });
    }
    if (method === "POST" && path === "/v1/auth/verify") {
      rate(req, "verify", 60);
      const data = bodyObject(await readBody(req));
      const id = typeof data.attempt === "string" ? data.attempt : "";
      const attempt = attempts.get(id);
      if (!attempt || attempt.expiresAt <= now()) fail(410, "expired", "Sign-in has expired.");
      if (typeof data.code !== "string" || !/^\d{8}$/.test(data.code)) fail(400, "wrong_code", "Code is incorrect.");
      if (attempt.busy) fail(429, "rate_limited", "Try again later.");
      attempt.busy = true;
      let owner: Account;
      try { owner = await accountProxy.verify(attempt.admin, data.code); } finally { attempt.busy = false; }
      attempts.delete(id);
      const existing = state.accounts.find(item => item.id === owner.id);
      if (existing) existing.email = owner.email; else state.accounts.push(owner);
      const token = random(32);
      state.sessions.push({ hash: hash(token), accountId: owner.id, expiresAt: now() + sessionMs });
      store.changed();
      res.setHeader("set-cookie", cookie(token, sessionMs / 1000));
      return json(res, 200, { account: owner });
    }
    if (method === "POST" && path === "/v1/auth/signout") {
      const token = req.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith("omb_dash="))?.slice(9);
      if (token) { state.sessions = state.sessions.filter(session => session.hash !== hash(token)); store.changed(); }
      res.setHeader("set-cookie", cookie("", 0));
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && path === "/v1/enroll") {
      rate(req, "enroll", 30);
      const data = parseEnrollRequest(bodyObject(await readBody(req)));
      if (!data) fail(400, "invalid_request", "Invalid enrollment.");
      let publicKey: string;
      try {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.publicKey)) throw new Error();
        const der = Buffer.from(data.publicKey, "base64");
        const key = createPublicKey({ key: der, format: "der", type: "spki" });
        if (key.asymmetricKeyType !== "ed25519" || !key.export({ type: "spki", format: "der" }).equals(der)) throw new Error();
        publicKey = der.toString("base64");
      } catch { fail(400, "invalid_key", "Public key is invalid."); }
      let ws = state.workspaces.find(item => item.publicKey === publicKey);
      if (ws?.ownerAccountId) return json(res, 200, { v: 1, workspaceId: ws.id, claimUrl: `${publicUrl}/?workspace=${ws.id}`, claimExpiresAt: 0, dashboardUrl: publicUrl });
      const token = random(24);
      if (!ws) {
        ws = { id: `ws_${random(16)}`, publicKey, ownerAccountId: null, claimHash: null, claimExpiresAt: 0, name: data.name, kind: data.kind,
          version: data.version, connectedAt: now(), lastReportAt: null, lastSeq: 0, lastSeqAt: 0, report: null, sectionAt: {} };
        state.workspaces.push(ws);
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
    if (method === "GET" && path === "/v1/me") return json(res, 200, { account: account(req) });
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
    handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      return route(req, res).catch(error => {
        if (error instanceof RequestError || error instanceof AccountError) json(res, error.status, { error: error.message, code: error.code });
        else json(res, 500, { error: "Request failed.", code: "failed" });
      });
    },
    close() {
      closed = true;
      for (const wait of [...waits.values()]) wait.cancel();
      store.close();
    },
  };
}
