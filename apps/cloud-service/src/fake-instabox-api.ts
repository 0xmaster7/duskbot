// A loopback stand-in for InstaBox's API v1, for tests: machines with labels and unique names, operations, suspend that
// keeps memory (or boots fresh when told to), public ports, exec through a scripted handler that plays the machine,
// file upload and download, activity leases, snapshots, usage and deletions with confirmation. Each machine's /data is a
// map of tar paths ("data/..."); its memory is a set of strings a test can check survives a pause.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makeTar, tarEntries } from "./backups.ts";
import { INSTABOX_RESTORE_FILE, INSTABOX_SETUP_STATUS, INSTABOX_SNAPSHOT_FILE } from "./instabox-home.ts";

export interface FakeMachine {
  id: string; name: string; state: string; ready: boolean; metadata: Record<string, string>; vcpus: number; memMiB: number; template: string | null; snapshotId: string | null;
  autoSuspendAfterSeconds: number | null; createdAt: number; updatedAt: number; files: Map<string, Buffer>; volume: Map<string, Buffer>; memory: Set<string>;
  ports: Map<number, string>; leases: Map<string, number>; processesPreserved: boolean | null; runningMs: number; runningSince: number | null; setupPolls: number;
}
export interface FakeExec { machine: FakeMachine; cmd: string }

export async function startFakeInstaboxApi(options: { now?: () => number; key?: string; setupPolls?: number } = {}) {
  const now = options.now ?? Date.now, key = options.key ?? `ibk_${"t".repeat(52)}`;
  const machines = new Map<string, FakeMachine>(), operations = new Map<string, Record<string, unknown>>(), snapshots = new Map<string, { id: string; name: string; status: string; createdAt: number; source: string }>();
  const requests: Array<{ method: string; path: string; body: unknown; headers: Record<string, string | string[] | undefined> }> = [];
  const idem = new Map<string, unknown>();
  let failNext = 0, limitNext = 0, coldResume = false, refuseResume: string | null = null;
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const ident = (prefix: string) => `${prefix}_${Array.from(randomBytes(26), b => alphabet[b % alphabet.length]).join("")}`;
  const iso = (t: number) => new Date(t).toISOString();
  const view = (m: FakeMachine) => ({ id: m.id, name: m.name, state: m.state, desiredState: m.state, operationId: null, template: m.template ? { id: m.template, version: "fake" } : null,
    spec: { vcpus: m.vcpus, memMiB: m.memMiB, persistentDiskGiB: 20, rootDiskGiB: 16 }, storage: { sizeGiB: 20, mountPath: "/data", persistent: true, synced: true },
    runtime: { ready: m.ready, ...(m.processesPreserved === null ? {} : { processesPreserved: m.processesPreserved }) }, autoSuspendAfterSeconds: m.autoSuspendAfterSeconds,
    metadata: m.metadata, guestUser: "user", createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt) });
  function operation(m: FakeMachine, type: string) { const op = { id: ident("op"), machineId: m.id, type, state: "succeeded", error: null, createdAt: iso(now()), updatedAt: iso(now()) }; operations.set(op.id, op); return op; }
  const settle = (m: FakeMachine) => { if (m.runningSince !== null) { m.runningMs += now() - m.runningSince; m.runningSince = null; } };
  const run = (m: FakeMachine) => { m.state = "running"; m.ready = true; m.runningSince = now(); m.updatedAt = now(); };

  let handler: (input: FakeExec) => { exitCode: number; stdout: string } | null = () => null;
  function machineExec({ machine, cmd }: FakeExec): { exitCode: number; stdout: string } {
    const custom = handler({ machine, cmd });
    if (custom) return custom;
    if (cmd.includes("setsid nohup bash -c")) { machine.setupPolls = 0; return { exitCode: 0, stdout: "launched\n" }; }
    if (cmd === "sync") return { exitCode: 0, stdout: "" };
    if (cmd.includes("omb-home install")) return { exitCode: 0, stdout: "installed\n" };
    if (cmd.includes("omb-home start")) { machine.memory.add("home"); return { exitCode: 0, stdout: "started\n" }; }
    if (cmd.includes("omb-home snapshot-done")) { machine.files.delete(INSTABOX_SNAPSHOT_FILE); return { exitCode: 0, stdout: "removed\n" }; }
    if (cmd.includes("omb-home snapshot")) {
      const tar = makeTar([...machine.volume].map(([name, data]) => ({ name, data })));
      machine.files.set(INSTABOX_SNAPSHOT_FILE, tar);
      return { exitCode: 0, stdout: `snapshot ${tar.length}\n` };
    }
    if (cmd.includes("omb-home restore")) {
      const tar = machine.files.get(INSTABOX_RESTORE_FILE);
      if (!tar) return { exitCode: 2, stdout: "not a home backup\n" };
      const entries = tarEntries(tar).filter(e => e.type === "0");
      if (!entries.some(e => e.name.endsWith(".omb-cloud-home.json"))) return { exitCode: 2, stdout: "not a home backup\n" };
      machine.volume = new Map(entries.map(e => [e.name.replace(/^(?:__system__\/)?/, "").replace(/^(?:\.\/)?/, ""), e.data]));
      machine.files.delete(INSTABOX_RESTORE_FILE);
      return { exitCode: 0, stdout: "restored\n" };
    }
    if (cmd.includes("omb-home verify")) {
      const manifest = [...machine.files].find(([path]) => path.endsWith(".sha256"))?.[1]?.toString("utf8") ?? "";
      const bad = manifest.split("\n").filter(Boolean).filter(line => {
        const [hash, path] = [line.slice(0, 64), line.slice(66)];
        const data = machine.volume.get(path.replace(/^\//, ""));
        return !data || sha256(data) !== hash;
      }).map(line => `${line.slice(66)}: FAILED`);
      return { exitCode: 0, stdout: `${bad.join("\n")}\nmismatched ${bad.length}\n` };
    }
    return { exitCode: 0, stdout: "" };
  }

  function send(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }
  const error = (res: ServerResponse, status: number, code: string, extra: Record<string, unknown> = {}) => send(res, status, { error: { code, message: code, retryable: status >= 500 || status === 429, ...extra } });
  async function read(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); return Buffer.concat(chunks); }
  const lookup = (idOrName: string) => machines.get(idOrName) ?? [...machines.values()].find(m => m.name === idOrName);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake"), method = req.method ?? "GET", raw = await read(req), path = url.pathname;
    if (req.headers["x-api-key"] !== key) return error(res, 401, "invalid_key");
    const isFile = path.endsWith("/files") && method === "PUT";
    let body: any = null;
    if (!isFile) { try { body = raw.length ? JSON.parse(raw.toString("utf8")) : null; } catch { return error(res, 400, "bad_request"); } }
    requests.push({ method, path: `${path}${url.search}`, body: isFile ? `<${raw.length} bytes>` : body, headers: req.headers });
    if (failNext > 0) { failNext--; return error(res, 503, "host_unavailable"); }
    if (limitNext > 0) { limitNext--; res.writeHead(429, { "content-type": "application/json", "retry-after": "40" }); res.end(JSON.stringify({ error: { code: "rate_limited", retryable: true, retryAfterSeconds: 40 } })); return; }
    const needsKey = method !== "GET" && /\/(machines|suspend|resume|start|stop|snapshots)$/.test(path) || (method === "DELETE" && /^\/v1\/(machines|snapshots)\/[^/]+$/.test(path)) || (method === "PATCH");
    const idemKey = req.headers["idempotency-key"];
    if (needsKey && !idemKey) return error(res, 400, "bad_request", { message: "Idempotency-Key required" });
    if (path === "/v1/usage" && method === "GET") return send(res, 200, { machines: machines.size, limits: { maxMachines: 500 } });
    const op = /^\/v1\/operations\/(op_[a-z2-7]{26})$/.exec(path);
    if (op) { const found = operations.get(op[1]!); return found ? send(res, 200, found) : error(res, 404, "not_found"); }
    if (path === "/v1/snapshots" && method === "GET") return send(res, 200, { snapshots: [...snapshots.values()].map(s => ({ ...s, createdAt: iso(s.createdAt) })) });
    const snap = /^\/v1\/snapshots\/(sn_[a-z2-7]{26})$/.exec(path);
    if (snap && method === "DELETE") { if (req.headers["x-confirm-delete"] !== snap[1]) return error(res, 409, "delete_confirmation_required"); snapshots.delete(snap[1]!); res.writeHead(204); res.end(); return; }
    if (path === "/v1/machines" && method === "POST") {
      const prior = idem.get(String(idemKey));
      if (prior) return send(res, 202, prior);
      const known = new Set(["name", "templateId", "snapshotId", "vcpus", "memMiB", "autoSuspendAfterSeconds", "vault", "secrets", "metadata", "envSecrets", "desiredState", "maxRunMinutes", "archiveSeconds", "deleteAfterSeconds"]);
      const unknown = Object.keys(body ?? {}).find(k => !known.has(k));
      if (unknown) return error(res, 400, "unknown_field", { message: unknown });
      if (body?.name && [...machines.values()].some(m => m.name === body.name)) return error(res, 409, "name_taken");
      const m: FakeMachine = { id: ident("m"), name: body?.name ?? `box-${randomBytes(4).toString("hex")}`, state: "running", ready: true, metadata: body?.metadata ?? {}, vcpus: body?.vcpus ?? 4, memMiB: body?.memMiB ?? 8192,
        template: body?.snapshotId ? null : body?.templateId ?? "agent-browser", snapshotId: body?.snapshotId ?? null, autoSuspendAfterSeconds: body?.autoSuspendAfterSeconds ?? 1800,
        createdAt: now(), updatedAt: now(), files: new Map(), volume: new Map(), memory: new Set(), ports: new Map(), leases: new Map(), processesPreserved: null, runningMs: 0, runningSince: now(), setupPolls: 0 };
      machines.set(m.id, m);
      const answer = operation(m, "create");
      idem.set(String(idemKey), answer);
      return send(res, 202, answer);
    }
    if (path === "/v1/machines" && method === "GET") {
      const filters = url.searchParams.getAll("metadata").map(f => f.split(":"));
      const all = [...machines.values()].filter(m => filters.every(([k, v]) => m.metadata[k!] === v));
      const limit = Number(url.searchParams.get("limit") ?? 100), start = Number(url.searchParams.get("cursor") ?? 0), page = all.slice(start, start + limit);
      return send(res, 200, { machines: page.map(view), nextCursor: start + limit < all.length ? String(start + limit) : null });
    }
    const match = /^\/v1\/machines\/([^/]+)(?:\/(.+))?$/.exec(path);
    const m = match ? lookup(decodeURIComponent(match[1]!)) : undefined;
    if (!match || !m) return error(res, 404, "not_found");
    const action = match[2] ?? "";
    if (!action && method === "GET") return send(res, 200, view(m));
    if (!action && method === "PATCH") {
      if (body?.metadata) m.metadata = body.metadata;
      if (typeof body?.autoSuspendAfterSeconds === "number") m.autoSuspendAfterSeconds = body.autoSuspendAfterSeconds || null;
      if (body?.vcpus !== undefined) { if (m.state !== "stopped") return error(res, 409, "operation_conflict"); m.vcpus = body.vcpus; m.memMiB = body.memMiB; }
      return send(res, 200, view(m));
    }
    if (!action && method === "DELETE") {
      if (req.headers["x-confirm-delete"] !== m.id && req.headers["x-confirm-delete"] !== m.name) return error(res, 409, "delete_confirmation_required");
      settle(m); machines.delete(m.id); m.state = "deleted";
      return send(res, 202, operation(m, "delete"));
    }
    const lifecycle = (type: string, allowed: string[], next: () => void) => {
      if (!allowed.includes(m.state)) return error(res, 409, "operation_conflict");
      next(); m.updatedAt = now();
      return send(res, 202, operation(m, type));
    };
    if (action === "suspend" && method === "POST") return lifecycle("suspend", ["running"], () => { settle(m); m.state = "suspended"; m.ready = false; m.leases.clear(); });
    if (action === "resume" && method === "POST") {
      if (refuseResume === m.id) return error(res, 409, "machine_cooldown", { retryAfterSeconds: 300 });
      return lifecycle("resume", ["suspended"], () => { run(m); m.processesPreserved = !coldResume; if (coldResume) m.memory.clear(); m.leases.clear(); });
    }
    if (action === "start" && method === "POST") return lifecycle("start", ["stopped", "suspended", "error"], () => { const fresh = m.state !== "suspended" || coldResume; run(m); m.processesPreserved = !fresh; if (fresh) m.memory.clear(); });
    if (action === "stop" && method === "POST") return lifecycle("stop", ["running"], () => { settle(m); m.state = "stopped"; m.ready = false; m.memory.clear(); });
    if (action === "ports" && method === "GET") return send(res, 200, { enabled: true, ports: [...m.ports].map(([port, u]) => ({ port, url: u, machineId: m.id })) });
    if (action === "ports" && method === "POST") {
      const u = m.ports.get(body.port) ?? `https://${body.port}-${m.id.slice(2)}.instabox.tech`;
      const created = !m.ports.has(body.port); m.ports.set(body.port, u);
      return send(res, created ? 201 : 200, { port: body.port, url: u, machineId: m.id });
    }
    if (action === "exec" && method === "POST") {
      if (m.state !== "running") return error(res, 409, "machine_not_running");
      if (typeof body?.cmd === "string" && body.cmd.includes("omb-setup") && body.cmd.includes("setsid")) m.setupPolls = 0;
      const result = machineExec({ machine: m, cmd: String(body?.cmd ?? "") });
      return send(res, 200, { stdout: result.stdout, stderr: "", exitCode: result.exitCode, timedOut: false, truncated: false });
    }
    if (action === "files" && method === "PUT") {
      if (m.state !== "running") return error(res, 409, "machine_not_running");
      const target = url.searchParams.get("path")!;
      const existed = m.files.has(target); m.files.set(target, raw);
      return send(res, existed ? 200 : 201, { path: target, size: raw.length, created: !existed });
    }
    if (action === "files/content" && method === "GET") {
      if (m.state !== "running") return error(res, 409, "machine_not_running");
      const target = url.searchParams.get("path")!;
      if (target === INSTABOX_SETUP_STATUS && m.files.has("/data/home/.omb-setup.sh") && !m.files.has(target) && ++m.setupPolls >= (options.setupPolls ?? 1)) m.files.set(target, Buffer.from("0\n"));
      const data = m.files.get(target);
      if (!data) return error(res, 404, "not_found");
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(data.length) }); res.end(data); return;
    }
    const lease = /^activity-leases\/([A-Za-z0-9_.-]+)$/.exec(action);
    if (lease && method === "PUT") { if (m.state !== "running") return error(res, 409, "machine_not_running"); m.leases.set(lease[1]!, now() + body.ttlSeconds * 1000); return send(res, 200, { id: lease[1], machineId: m.id, expiresAt: iso(now() + body.ttlSeconds * 1000) }); }
    if (lease && method === "DELETE") { m.leases.delete(lease[1]!); res.writeHead(204); res.end(); return; }
    if (action === "snapshots" && method === "POST") {
      if ([...snapshots.values()].some(s => s.name === body?.name)) return error(res, 409, "name_taken");
      const s = { id: ident("sn"), name: body.name, status: "ready", createdAt: now(), source: m.id }; snapshots.set(s.id, s);
      return send(res, 201, { ...s, createdAt: iso(s.createdAt) });
    }
    if (action === "usage" && method === "GET") {
      const ms = m.runningMs + (m.runningSince !== null ? now() - m.runningSince : 0);
      return send(res, 200, { from: iso(0), to: iso(now()), runningSeconds: Math.round(ms / 1000), vcpuSeconds: Math.round(ms / 1000) * m.vcpus, memGiBSeconds: ms / 1000 * m.memMiB / 1024, diskGiBSeconds: 0, egressBytes: 0 });
    }
    return error(res, 404, "not_found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`, key, machines, requests, snapshots,
    failNext(count: number) { failNext = count; },
    limitNext(count: number) { limitNext = count; },
    /** resumes cannot restore memory: the machine boots fresh (`processesPreserved: false`) */
    coldResume(on = true) { coldResume = on; },
    /** this machine's resumes are refused with a cooldown */
    refuseResume(machineId: string | null) { refuseResume = machineId; },
    onExec(fn: typeof handler) { handler = fn; },
    /** the machine is lost without anyone deleting it through the API */
    lose(machineId: string) { machines.delete(machineId); },
    /** the machine paused itself (idle, or our lease lapsed) */
    autoPause(machineId: string) { const x = machines.get(machineId); if (x && x.state === "running") { settle(x); x.state = "suspended"; x.ready = false; } },
    deletes: () => requests.filter(r => r.method === "DELETE" && /^\/v1\/machines\//.test(r.path)),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
export type FakeInstaboxApi = Awaited<ReturnType<typeof startFakeInstaboxApi>>;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
