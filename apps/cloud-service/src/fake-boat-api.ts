// A loopback stand-in for boat.dev's API v1, for tests: sandboxes with labels, idempotent create, stop and resume with a
// snapshot per stop, hosted ports, commands, upload URLs, snapshot folder reads as tar, deletions with receipts. Each
// sandbox's /data volume is a map of tar paths; the scripted command handler plays the machine.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { makeTar, tarEntries } from "./backups.ts";

export interface FakeSandbox {
  id: string; name: string; state: string; type: string; labels: Record<string, string>; ttlSeconds: number | null;
  createdAt: number; stoppedAt: number | null; dataExpiredAt: number | null; setupStatus: string | null; setupPolls: number; bootPolls: number;
  snapshotCompletedAt: number | null; files: Map<string, Buffer>; volume: Map<string, Buffer>; snapshots: Array<{ id: string; at: number; volume: Map<string, Buffer> }>;
  hosted: string | null; stop: { id: string; status: string } | null; refuseStop?: boolean;
}
export interface FakeCommand { sandbox: FakeSandbox; command: string }

export async function startFakeBoatApi(options: { now?: () => number; key?: string; bootPolls?: number; setupPolls?: number } = {}) {
  const now = options.now ?? Date.now, key = options.key ?? "boat_test_key_0123456789";
  const sandboxes = new Map<string, FakeSandbox>(), keys = new Map<string, string>(), uploads = new Map<string, { id: string; path: string }>();
  const operations = new Map<string, { id: string; kind: string; targetId: string; status: string }>();
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  let failNext = 0, limitNext = 0, sequence = 0, startLimit: { nextStartAt: number; window: string } | null = null;
  const named = new Map<string, { name: string; status: string; createdAt: number; polls: number }>();
  const id = () => `bx_${Array.from(randomBytes(8), b => alphabet[b % alphabet.length]).join("")}`;
  const iso = (t: number | null) => t === null ? null : new Date(t).toISOString();
  function view(s: FakeSandbox) {
    return { id: s.id, name: s.name, state: s.state, type: s.type, labels: s.labels, ttlSeconds: s.ttlSeconds, createdAt: iso(s.createdAt), stoppedAt: iso(s.stoppedAt),
      dataExpiredAt: iso(s.dataExpiredAt), setupStatus: s.setupStatus, snapshotCompletedAt: iso(s.snapshotCompletedAt), desktopAvailable: false, snapshotAvailable: s.snapshots.length > 0,
      stop: s.stop };
  }
  const capture = (s: FakeSandbox) => { const at = now(); s.snapshots.push({ id: `snap${String(++sequence).padStart(8, "0")}`, at, volume: new Map(s.volume) }); s.snapshotCompletedAt = at; };
  const baseCommand: (input: FakeCommand) => { exitCode: number; stdout: string } = ({ sandbox, command }) => {
    if (command.includes("omb-home install")) return { exitCode: 0, stdout: "installed\n" };
    if (command.includes("omb-home start")) return { exitCode: 0, stdout: "started\n" };
    if (command.includes("omb-home restore")) {
      const tar = sandbox.files.get("/home/user/omb-restore.tar");
      if (!tar) return { exitCode: 2, stdout: "not a home backup\n" };
      sandbox.volume = new Map(tarEntries(tar).filter(e => e.type === "0").map(e => [e.name.startsWith("__system__/") ? e.name : `__system__/${e.name}`, e.data]));
      return { exitCode: 0, stdout: "restored\n" };
    }
    if (command.includes("sha256sum -c")) {
      const manifest = [...sandbox.files].find(([path]) => path.endsWith(".sha256"))?.[1]?.toString("utf8") ?? "";
      const bad = manifest.split("\n").filter(Boolean).filter(line => {
        const data = sandbox.volume.get(`__system__${line.slice(66)}`);
        return !data || createHash("sha256").update(data).digest("hex") !== line.slice(0, 64);
      });
      return { exitCode: 0, stdout: `${bad.map(line => `${line.slice(66)}: FAILED`).join("\n")}\nmismatched ${bad.length}\n` };
    }
    return { exitCode: 0, stdout: "" };
  };
  let command = baseCommand;
  function send(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }
  const error = (res: ServerResponse, status: number, code: string) => send(res, status, { ok: false, code, error: { code, status } });
  async function read(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); return Buffer.concat(chunks); }
  function advance(s: FakeSandbox) {
    if (["provisioning", "init"].includes(s.state) && ++s.bootPolls >= (options.bootPolls ?? 1)) s.state = "ready";
    if (s.state === "ready" && s.setupStatus === "running" && ++s.setupPolls >= (options.setupPolls ?? 1)) s.setupStatus = "done";
    if (s.state === "archiving") { capture(s); s.state = "archived"; s.stoppedAt = now(); if (s.stop) s.stop.status = "completed"; }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake"), method = req.method ?? "GET", raw = await read(req);
    if (url.pathname.startsWith("/__upload/")) {
      const target = uploads.get(url.pathname.slice(10));
      const s = target && sandboxes.get(target.id);
      if (!target || !s || method !== "PUT") return error(res, 404, "not_found");
      s.files.set(target.path, raw); res.writeHead(200); res.end(); return;
    }
    if (req.headers.authorization !== `Bearer ${key}`) return error(res, 401, "unauthorized");
    let body: any = null;
    try { body = raw.length ? JSON.parse(raw.toString("utf8")) : null; } catch { return error(res, 400, "invalid_json"); }
    const path = url.pathname.replace(/^\/api\/v1/, "");
    requests.push({ method, path: `${path}${url.search}`, body });
    if (failNext > 0) { failNext--; return error(res, 503, "unavailable"); }
    // a start-limit refusal answers only starts (resume, create), as the provider's does
    if (startLimit && req.method === "POST" && (path.endsWith("/resume") || path === "/sandboxes")) {
      const { nextStartAt, window } = startLimit; startLimit = null;
      res.writeHead(429, { "content-type": "application/json", "retry-after": String(Math.max(1, Math.ceil((nextStartAt - now()) / 1000))) });
      res.end(JSON.stringify({ ok: false, error: { code: "rate_limited", window, limit: 12, cause: "plan", nextStartAt: new Date(nextStartAt).toISOString(), retryAfterSeconds: Math.ceil((nextStartAt - now()) / 1000) } })); return;
    }
    if (limitNext > 0) { limitNext--; res.writeHead(429, { "content-type": "application/json", "retry-after": "40" }); res.end(JSON.stringify({ ok: false, code: "rate_limited" })); return; }
    if (req.method === "GET" && path === "/limits") { send(res, 200, { nextStartDollars: 0 }); return; }
    if (path === "/named-snapshots" && method === "GET") return send(res, 200, { ok: true, snapshots: [...named.values()].map(x => ({ name: x.name, status: x.status, createdAt: iso(x.createdAt) })) });
    if (path === "/named-snapshots" && method === "POST") {
      if (!sandboxes.has(body?.sandboxId) || typeof body?.name !== "string") return error(res, 404, "not_found");
      if (named.has(body.name)) return error(res, 409, "snapshot_exists");
      named.set(body.name, { name: body.name, status: "saving", createdAt: now(), polls: 0 });
      return send(res, 202, { ok: true, snapshot: { name: body.name, status: "saving" } });
    }
    const namedMatch = /^\/named-snapshots\/([a-z0-9-]+)$/.exec(path);
    if (namedMatch) {
      const x = named.get(namedMatch[1]!);
      if (!x) return error(res, 404, "not_found");
      if (method === "DELETE") { named.delete(x.name); return send(res, 202, { ok: true }); }
      if (x.status === "saving" && ++x.polls >= 1) x.status = "ready";
      return send(res, 200, { ok: true, snapshot: { name: x.name, status: x.status, createdAt: iso(x.createdAt) } });
    }
    if (path === "/sandboxes" && method === "POST") {
      const idem = String(req.headers["idempotency-key"] ?? "");
      const prior = idem && keys.get(idem);
      if (prior && sandboxes.has(prior)) return send(res, 202, { ok: true, type: "sandbox.created", status: "ready", sandbox: view(sandboxes.get(prior)!) });
      const from = typeof body?.from === "string" ? body.from : null;
      const s: FakeSandbox = { id: id(), name: body?.name ?? "Sandbox", state: "provisioning", type: body?.type ?? "default", labels: body?.labels ?? {}, ttlSeconds: body?.ttlSeconds ?? 3600,
        createdAt: now(), stoppedAt: null, dataExpiredAt: null, setupStatus: body?.setupScript ? "running" : null, setupPolls: 0, bootPolls: 0, snapshotCompletedAt: null,
        files: new Map((body?.files ?? []).map((f: { path: string; content: string }) => [f.path, Buffer.from(f.content)])), volume: new Map(), snapshots: [], hosted: null, stop: null };
      if (from === "missing-template") return error(res, 404, "snapshot_not_found");
      sandboxes.set(s.id, s); if (idem) keys.set(idem, s.id);
      const hostedPorts = (body?.hostedPorts ?? []).map((p: { port: number }) => { s.hosted = `https://${s.id.slice(3)}-${p.port}.on.boat.dev`; return { port: p.port, url: s.hosted, access: "public", isProtected: false }; });
      return send(res, 202, { ok: true, type: "sandbox.created", status: "provisioning", sandbox: view(s), hostedPorts });
    }
    if (path === "/sandboxes" && method === "GET") {
      const labels = url.searchParams.getAll("label").map(l => l.split("="));
      const all = [...sandboxes.values()].filter(s => labels.every(([k, v]) => s.labels[k!] === v));
      const limit = Number(url.searchParams.get("limit") ?? 100), start = Number(url.searchParams.get("cursor") ?? 0), page = all.slice(start, start + limit);
      return send(res, 200, { ok: true, type: "sandbox.list", sandboxes: page.map(view), pageInfo: { hasMore: start + limit < all.length, nextCursor: start + limit < all.length ? String(start + limit) : null, limit } });
    }
    const deletion = /^\/deletion-operations\/(bdop_[a-f0-9]{32})$/.exec(path);
    if (deletion) { const op = operations.get(deletion[1]!); return op ? send(res, 200, { ok: true, operation: op }) : error(res, 404, "not_found"); }
    const snap = /^\/snapshots\/([A-Za-z0-9_-]+)\/files$/.exec(path);
    if (snap) {
      const found = [...sandboxes.values()].flatMap(s => s.snapshots).find(x => x.id === snap[1]);
      if (!found) return error(res, 404, "not_found");
      const prefix = `${url.searchParams.get("path") ?? ""}/`;
      res.writeHead(200, { "content-type": "application/x-tar" });
      res.end(makeTar([...found.volume].filter(([name]) => name.startsWith(prefix)).map(([name, data]) => ({ name, data }))));
      return;
    }
    const m = /^\/sandboxes\/(bx_[a-z0-9]{8})(?:\/([a-z/-]+))?$/.exec(path);
    const s = m && sandboxes.get(m[1]!);
    if (!m || !s) return error(res, 404, "not_found");
    const action = m[2] ?? "";
    if (!action && method === "GET") { advance(s); return send(res, 200, { ok: true, type: "sandbox.info", sandbox: view(s) }); }
    if (!action && method === "PATCH") { if (body && "ttlSeconds" in body) s.ttlSeconds = body.ttlSeconds; return send(res, 200, { ok: true, sandbox: view(s) }); }
    if (!action && method === "DELETE") {
      if (req.headers["x-ascii-confirm-delete"] !== s.id) return error(res, 409, "confirmation_required");
      sandboxes.delete(s.id);
      const op = { id: `bdop_${randomBytes(16).toString("hex")}`, kind: "sandbox", targetId: s.id, status: "completed" };
      operations.set(op.id, op);
      return send(res, 202, { ok: true, type: "sandbox.deleting", operation: op });
    }
    if (action === "stop" && method === "POST") {
      if (s.state === "archived") return send(res, 200, { ok: true, status: "archived", sandbox: view(s) });
      if (s.refuseStop) { s.stop = { id: `stop_${randomBytes(8).toString("hex")}`, status: "failing" }; return send(res, 202, { ok: true, status: "running", sandbox: view(s) }); }
      s.stop = { id: `stop_${randomBytes(8).toString("hex")}`, status: "pending" }; s.state = "archiving";
      return send(res, 202, { ok: true, status: "archiving", sandbox: view(s) });
    }
    if (action === "resume" && method === "POST") {
      if (s.dataExpiredAt !== null) return error(res, 409, "snapshot_data_expired");
      if (!["archived", "error"].includes(s.state)) return error(res, 409, "sandbox_resuming");
      s.state = "provisioning"; s.bootPolls = 0; s.stoppedAt = null; s.stop = null;
      if (typeof body?.type === "string") s.type = body.type;
      return send(res, 202, { ok: true, status: "resuming", sandbox: view(s) });
    }
    if (action === "host" && method === "POST") { s.hosted ??= `https://${s.id.slice(3)}-${body.port}.on.boat.dev`; return send(res, 200, { ok: true, port: body.port, url: s.hosted, access: "public" }); }
    if (action === "commands" && method === "POST") {
      if (!["ready", "idle", "running"].includes(s.state)) return error(res, 409, "sandbox_not_ready");
      const result = command({ sandbox: s, command: String(body?.command ?? "") });
      return send(res, 200, { ok: true, type: "command.finished", success: result.exitCode === 0, exitCode: result.exitCode, stdout: result.stdout, stderr: "", timedOut: false });
    }
    if (action === "files/upload-url" && method === "POST") {
      const token = randomBytes(12).toString("hex"); uploads.set(token, { id: s.id, path: body.path });
      const address = server.address() as AddressInfo;
      return send(res, 200, { ok: true, url: `http://127.0.0.1:${address.port}/__upload/${token}` });
    }
    if (action === "snapshots/latest" && method === "GET") {
      const last = s.snapshots.at(-1);
      return send(res, 200, { ok: true, snapshot: last ? { id: last.id, completedAt: iso(last.at) } : null });
    }
    return error(res, 404, "not_found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`, key, sandboxes, requests,
    failNext(count: number) { failNext = count; },
    /** the next start answers a start-limit 429 naming the window and when the next start may happen */
    limitNextStart(nextStartAt: number, window = "minute") { startLimit = { nextStartAt, window }; },
    /** the next requests answer 429 with Retry-After: 40 */
    limitNext(count: number) { limitNext = count; },
    /** stops of this sandbox fail (the pre-stop hook timed out, say): it keeps running with stop.status "failing" */
    refuseStop(sandboxId: string, refuse = true) { const x = sandboxes.get(sandboxId); if (x) { x.refuseStop = refuse; if (!refuse && x.stop?.status === "failing") x.stop = null; } },
    named,
    onCommand(fn: typeof command) { command = fn; },
    /** the machine's own answers, for a handler that adds to them */
    baseCommand,
    /** the machine is lost without anyone deleting it through the API */
    lose(sandboxId: string) { sandboxes.delete(sandboxId); },
    expire(sandboxId: string) { const s = sandboxes.get(sandboxId); if (s) s.dataExpiredAt = now(); },
    /** a background snapshot of a running sandbox */
    snapshot(sandboxId: string) { const s = sandboxes.get(sandboxId); if (s) capture(s); },
    deletes: () => requests.filter(r => r.method === "DELETE"),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
export type FakeBoatApi = Awaited<ReturnType<typeof startFakeBoatApi>>;
