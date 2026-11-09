// boat.dev public API v1 (https://docs.boat.dev/api/v1, OpenAPI https://docs.boat.dev/openapi/boat-v1.yaml), read 2026-11-09.
// Boat facts this file relies on: create takes an Idempotency-Key (24 h) and labels only at create; LIST is eventually
// consistent, so only a direct GET 404 proves a sandbox is gone; stop saves the disk (enabled systemd units start again on
// resume, processes do not); a stopped disk may be purged 14 days after the stop (dataExpiredAt); DELETE needs
// X-Ascii-Confirm-Delete and is irreversible; hosted port URLs are stable for a sandbox's life.
import { createHash } from "node:crypto";
import type { MachineSpec } from "../../../../shared/billing-api.ts";
import { boundedJson, RetryableCloudError } from "./http.ts";
import type { CloudProvider, CreateServerInput, ProviderServer } from "./types.ts";

export const BOAT_SIZES = [
  { type: "small", vcpu: 2, ramGb: 4, diskGb: 51 },
  { type: "default", vcpu: 4, ramGb: 8, diskGb: 51 },
  { type: "large", vcpu: 8, ramGb: 16, diskGb: 111 },
  { type: "xlarge", vcpu: 16, ramGb: 32, diskGb: 251 },
] as const;
export type BoatSize = (typeof BOAT_SIZES)[number]["type"];
/** the public port of the home's edge (server/cloud-home-start.ts) */
export const BOAT_HOME_PORT = 8080;
const SANDBOX_ID = /^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;
const OPERATION_ID = /^bdop_[a-f0-9]{32}$/;
const SNAPSHOT_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CLOUD_ID = /^c[0-9a-f]{24}$/;
/** every resume says no-env again: Boat documents it as one-way on resume, but not that a create's noEnv carries over */
const RESUME = { noEnv: true } as const;

export interface BoatSandbox {
  id: string;
  state: string;
  cloudId: string | null;
  scope: string | null;
  type: string | null;
  stoppedAt: number | null;
  dataExpired: boolean;
  setup: "pending" | "running" | "done" | "failed" | null;
  stopStatus: string | null;
  snapshotAt: number | null;
  createdAt: number | null;
}
export interface BoatCommandResult { ok: boolean; exitCode: number | null; stdout: string }
export interface BoatDeletion { id: string; status: "pending" | "processing" | "blocked" | "completed" }
export interface BoatCreateInput extends CreateServerInput {
  /** written before the setup script runs, only at the first start (Boat `files`) */
  files?: Array<{ path: string; content: string }>;
  /** a saved snapshot to start from: the operator's template, or a backup */
  from?: string;
  ttlSeconds: number | null;
  /** distinguishes a deliberate second create for the same cloud (a recovery) from a retry */
  attempt?: number;
}

/** a Boat sandbox per cloud. destroy() is reachable only through the clouds service's deletion gate (boat-retention.ts). */
export interface BoatProvider extends CloudProvider {
  readonly name: "boat";
  readonly scope: string;
  create(input: BoatCreateInput): Promise<ProviderServer>;
  sandbox(serverId: string): Promise<BoatSandbox | null>;
  /** this deployment's sandboxes: every page, own scope only */
  inventory(): Promise<BoatSandbox[]>;
  /** whether the account's whole list (no filters) still shows this sandbox */
  listed(serverId: string): Promise<boolean>;
  /** https origin of the home's edge port, public, stable for the sandbox's life */
  origin(serverId: string): Promise<string>;
  /** a shell command as the sandbox user (passwordless sudo); stdout is bounded and never carries a secret by contract */
  run(serverId: string, command: string, timeoutSeconds?: number): Promise<BoatCommandResult>;
  /** the dead-man lease: Boat stops the sandbox by itself this many seconds from now unless extended again */
  lease(serverId: string, ttlSeconds: number | null): Promise<void>;
  /** id of the newest completed automatic snapshot, or null */
  latestSnapshot(serverId: string): Promise<{ id: string; at: number } | null>;
  /** a folder of a snapshot as a tar stream, read from storage: the machine is never contacted */
  snapshotTar(snapshotId: string, path: string): Promise<ReadableStream<Uint8Array>>;
  /** raw bytes to a path under /home/user on a running sandbox, through a short-lived upload URL */
  upload(serverId: string, path: string, body: Uint8Array): Promise<void>;
  deletion(operationId: string): Promise<BoatDeletion | null>;
  /** sends the DELETE once; the operation id is the receipt */
  requestDelete(serverId: string): Promise<{ operationId: string | null; gone: boolean }>;
}

export class BoatError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(`Boat refused the request: ${code}.`); this.name = "BoatError"; this.status = status; this.code = code; }
}

export function boatSize(spec: MachineSpec, smallest: BoatSize = "small"): BoatSize {
  const floor = BOAT_SIZES.findIndex(s => s.type === smallest);
  const size = BOAT_SIZES.slice(Math.max(0, floor)).find(s => s.vcpu >= spec.vcpu && s.ramGb >= spec.ramGb);
  if (!size) throw new Error("Cloud machine size unavailable.");
  return size.type;
}

/** a short label for one dashboard deployment, so two deployments sharing a Boat account never touch each other's sandboxes */
export function boatScope(publicUrl: string): string { return createHash("sha256").update(new URL(publicUrl).origin).digest("hex").slice(0, 16); }

const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
function sandboxOf(value: unknown): BoatSandbox | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>, labels = (s.labels && typeof s.labels === "object" ? s.labels : {}) as Record<string, unknown>;
  if (typeof s.id !== "string" || !SANDBOX_ID.test(s.id) || typeof s.state !== "string") return null;
  const cloudId = typeof labels["omb.cloud"] === "string" && CLOUD_ID.test(labels["omb.cloud"]) ? labels["omb.cloud"] : null;
  const setup = ["pending", "running", "done", "failed"].includes(s.setupStatus as string) ? s.setupStatus as BoatSandbox["setup"] : null;
  const stop = s.stop && typeof s.stop === "object" ? (s.stop as Record<string, unknown>).status : null;
  return { id: s.id, state: s.state, cloudId, scope: typeof labels["omb.scope"] === "string" ? labels["omb.scope"] : null, type: typeof s.type === "string" ? s.type : null,
    stoppedAt: time(s.stoppedAt), dataExpired: time(s.dataExpiredAt) !== null, setup, stopStatus: typeof stop === "string" ? stop : null,
    snapshotAt: time(s.snapshotCompletedAt), createdAt: time(s.createdAt) };
}
function mapped(s: BoatSandbox): ProviderServer {
  const states: Record<string, ProviderServer["state"]> = { init: "creating", provisioning: "creating", provisioned: "starting", cloning: "starting", ready: "running", idle: "running", running: "running", archiving: "stopping", archived: "off", error: "error", cancelled: "missing" };
  // a refused stop keeps the sandbox up with stop.status failing: it is stopping, not running
  const state = s.stopStatus === "failing" && states[s.state] === "running" ? "stopping" : states[s.state] ?? "starting";
  return { id: s.id, state: s.dataExpired && state === "off" ? "error" : state, ipv4: null, serverType: s.type ?? "", diskGb: BOAT_SIZES.find(z => z.type === s.type)?.diskGb ?? 0 };
}

export interface BoatProviderOptions {
  apiKey: string;
  /** https://boat.dev or https://boat.dev/api/v1 */
  baseUrl?: string;
  scope: string;
  fetch?: typeof fetch;
  smallest?: BoatSize;
}

export function createBoatProvider(options: BoatProviderOptions): BoatProvider {
  const fetcher = options.fetch ?? fetch, key = options.apiKey;
  if (!key || /[\r\n\s]/.test(key)) throw new Error("Invalid BOAT_API_KEY.");
  if (!/^[a-f0-9]{16}$/.test(options.scope)) throw new Error("Invalid Boat scope.");
  const root = (options.baseUrl ?? "https://boat.dev").replace(/\/+$/, "");
  const base = root.endsWith("/api/v1") ? root : `${root}/api/v1`;
  const url = new URL(base);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Invalid BOAT_BASE_URL.");
  const origins = new Map<string, string>();
  const safeCode = (value: unknown) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) && !value.includes(key) ? value : "failed";

  async function call(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; missingOk?: boolean; timeoutMs?: number; limit?: number } = {}): Promise<Record<string, any> | null> {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
        headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    } catch { throw new RetryableCloudError(); }
    if (init.missingOk && (response.status === 404 || response.status === 410)) { await response.body?.cancel(); return null; }
    if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw new RetryableCloudError(); }
    let data: Record<string, any> | null = null;
    try { data = await boundedJson(response, init.limit ?? 2_097_152) as Record<string, any>; } catch { if (response.ok) throw new RetryableCloudError(); }
    if (!response.ok || data?.ok === false) {
      const code = safeCode(data?.error?.code ?? data?.code);
      if (["idempotency_in_progress", "sandbox_resuming", "sandbox_stopping", "boat_starting", "sandbox_starting", "save_in_progress", "sandbox_busy"].includes(code)) throw new RetryableCloudError(`Boat is busy: ${code}.`);
      throw new BoatError(response.status, code);
    }
    return data ?? {};
  }
  async function get(serverId: string) {
    if (!SANDBOX_ID.test(serverId)) throw new Error("Invalid Boat sandbox id.");
    const data = await call("GET", `/sandboxes/${serverId}`, { missingOk: true });
    const s = data ? sandboxOf(data.sandbox) : null;
    if (data && !s) throw new RetryableCloudError();
    return s && s.state !== "cancelled" ? s : null;
  }
  async function list(query: string): Promise<BoatSandbox[]> {
    const found: BoatSandbox[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const data: Record<string, any> | null = await call("GET", `/sandboxes?limit=200&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const value of data?.sandboxes ?? []) { const s = sandboxOf(value); if (s && s.scope === options.scope) found.push(s); }
      cursor = data?.pageInfo?.hasMore && typeof data.pageInfo.nextCursor === "string" ? data.pageInfo.nextCursor : null;
      if (!cursor) return found;
    }
    throw new RetryableCloudError("Boat inventory too long.");
  }
  const scoped = `label=${encodeURIComponent(`omb.scope=${options.scope}`)}`;

  const provider: BoatProvider = {
    name: "boat",
    scope: options.scope,
    async find(cloudId) {
      if (!CLOUD_ID.test(cloudId)) throw new Error("Invalid cloud id.");
      const listed = (await list(`${scoped}&label=${encodeURIComponent(`omb.cloud=${cloudId}`)}`)).filter(s => s.cloudId === cloudId && s.state !== "cancelled");
      // the list lags: confirm with a direct read, newest first
      for (const s of listed.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))) {
        const direct = await get(s.id);
        if (direct) return mapped(direct);
      }
      return null;
    },
    async create(input) {
      if (!CLOUD_ID.test(input.cloudId)) throw new Error("Invalid cloud id.");
      if (input.from !== undefined && !SNAPSHOT_NAME.test(input.from)) throw new Error("Invalid Boat snapshot name.");
      const body = {
        type: boatSize(input.spec, options.smallest), ttlSeconds: input.ttlSeconds, noEnv: true, monitoring: false, name: `omb-${input.cloudId}`,
        labels: { "omb.cloud": input.cloudId, "omb.scope": options.scope },
        ...(input.userData ? { setupScript: input.userData } : {}), ...(input.files?.length ? { files: input.files } : {}), ...(input.from ? { from: input.from } : {}),
        hostedPorts: [{ port: BOAT_HOME_PORT, public: true, title: "OpenMausBot" }],
      };
      // one key per cloud and attempt: a lost answer retried within 24 h returns the same sandbox, never a second one
      const idempotency = `omb-${options.scope}-${input.cloudId}-${input.attempt ?? 0}`;
      const data = await call("POST", "/sandboxes", { body, headers: { "Idempotency-Key": idempotency }, timeoutMs: 90_000 });
      const s = sandboxOf(data?.sandbox);
      if (!s) throw new RetryableCloudError();
      const hosted = (data?.hostedPorts ?? []).find((p: Record<string, unknown>) => p?.port === BOAT_HOME_PORT && typeof p.url === "string");
      if (hosted) { const origin = new URL(hosted.url).origin; if (origin.startsWith("https://")) origins.set(s.id, origin); }
      return { ...mapped(s), ...(origins.has(s.id) ? { origin: origins.get(s.id) } : {}) };
    },
    async status(serverId) {
      const s = await get(serverId);
      return s ? mapped(s) : { id: serverId, state: "missing", ipv4: null, serverType: "", diskGb: 0 };
    },
    sandbox: get,
    inventory: () => list(scoped),
    async listed(serverId) {
      let cursor: string | null = null;
      for (let page = 0; page < 50; page++) {
        const data: Record<string, any> | null = await call("GET", `/sandboxes?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if ((data?.sandboxes ?? []).some((s: { id?: unknown }) => s?.id === serverId)) return true;
        cursor = data?.pageInfo?.hasMore && typeof data.pageInfo.nextCursor === "string" ? data.pageInfo.nextCursor : null;
        if (!cursor) return false;
      }
      throw new RetryableCloudError("Boat list too long.");
    },
    async origin(serverId) {
      const known = origins.get(serverId);
      if (known) return known;
      const data = await call("POST", `/sandboxes/${serverId}/host`, { body: { port: BOAT_HOME_PORT, public: true, title: "OpenMausBot" } });
      const origin = typeof data?.url === "string" ? new URL(data.url).origin : "";
      if (!/^https:\/\/[a-z0-9-]+\.on\.boat\.dev$/.test(origin) && !origin.startsWith("https://")) throw new RetryableCloudError();
      origins.set(serverId, origin);
      return origin;
    },
    async power(serverId, action) {
      if (!SANDBOX_ID.test(serverId)) throw new Error("Invalid Boat sandbox id.");
      if (action === "off") { await call("POST", `/sandboxes/${serverId}/stop`, { body: {} }); return; }
      const s = await get(serverId);
      if (!s) throw new BoatError(404, "not_found");
      if (["archived", "archiving", "error"].includes(s.state)) await call("POST", `/sandboxes/${serverId}/resume`, { body: RESUME });
    },
    async suspend(serverId) { await provider.power(serverId, "off"); },
    async resize(serverId, spec) {
      const s = await get(serverId);
      if (!s || s.state !== "archived") throw new Error("Cloud server must be off to resize.");
      await call("POST", `/sandboxes/${serverId}/resume`, { body: { ...RESUME, type: boatSize(spec, options.smallest) } });
    },
    async run(serverId, command, timeoutSeconds = 120) {
      if (!SANDBOX_ID.test(serverId)) throw new Error("Invalid Boat sandbox id.");
      const data = await call("POST", `/sandboxes/${serverId}/commands`, { body: { command, timeoutSeconds: Math.min(600, Math.max(1, timeoutSeconds)) }, timeoutMs: (timeoutSeconds + 30) * 1000, limit: 1_048_576 });
      return { ok: data?.success === true && data.exitCode === 0, exitCode: typeof data?.exitCode === "number" ? data.exitCode : null, stdout: typeof data?.stdout === "string" ? data.stdout.slice(0, 65_536) : "" };
    },
    async lease(serverId, ttlSeconds) {
      if (!SANDBOX_ID.test(serverId)) throw new Error("Invalid Boat sandbox id.");
      await call("PATCH", `/sandboxes/${serverId}`, { body: { ttlSeconds } });
    },
    async latestSnapshot(serverId) {
      const data = await call("GET", `/sandboxes/${serverId}/snapshots/latest`, { missingOk: true });
      const snapshot = data?.snapshot;
      if (!snapshot || typeof snapshot.id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(snapshot.id)) return null;
      return { id: snapshot.id, at: time(snapshot.completedAt ?? snapshot.createdAt) ?? 0 };
    },
    async snapshotTar(snapshotId, path) {
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(snapshotId) || !/^[A-Za-z0-9._/-]{1,200}$/.test(path) || path.includes("..")) throw new Error("Invalid snapshot read.");
      let response: Response;
      try {
        response = await fetcher(`${base}/snapshots/${snapshotId}/files?path=${encodeURIComponent(path)}`, { redirect: "follow", signal: AbortSignal.timeout(30 * 60_000), headers: { authorization: `Bearer ${key}` } });
      } catch { throw new RetryableCloudError(); }
      if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw new RetryableCloudError(); }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new BoatError(response.status, "snapshot_read_failed"); }
      return response.body;
    },
    async upload(serverId, path, body) {
      if (!/^\/home\/user\/[A-Za-z0-9._/-]{1,200}$/.test(path) || path.includes("..")) throw new Error("Invalid upload path.");
      const data = await call("POST", `/sandboxes/${serverId}/files/upload-url`, { body: { path, ttlSeconds: 900 } });
      const target = typeof data?.url === "string" ? data.url : typeof data?.uploadUrl === "string" ? data.uploadUrl : null;
      if (!target || !target.startsWith("https://") && !target.startsWith("http://127.0.0.1")) throw new RetryableCloudError();
      let response: Response;
      try { response = await fetcher(target, { method: "PUT", body, redirect: "error", signal: AbortSignal.timeout(30 * 60_000), headers: { "content-type": "application/octet-stream" } }); }
      catch { throw new RetryableCloudError(); }
      await response.body?.cancel();
      if (!response.ok) throw response.status >= 500 ? new RetryableCloudError() : new BoatError(response.status, "upload_failed");
    },
    async deletion(operationId) {
      if (!OPERATION_ID.test(operationId)) throw new Error("Invalid Boat deletion id.");
      const data = await call("GET", `/deletion-operations/${operationId}`, { missingOk: true });
      const op = data?.operation;
      return op && op.id === operationId && ["pending", "processing", "blocked", "completed"].includes(op.status) ? { id: op.id, status: op.status } : null;
    },
    async requestDelete(serverId) {
      if (!SANDBOX_ID.test(serverId)) throw new Error("Invalid Boat sandbox id.");
      const data = await call("DELETE", `/sandboxes/${serverId}`, { headers: { "X-Ascii-Confirm-Delete": serverId }, missingOk: true });
      if (!data) return { operationId: null, gone: true };
      const id = data.operation?.id;
      return { operationId: typeof id === "string" && OPERATION_ID.test(id) ? id : null, gone: false };
    },
    // the clouds service never reaches this: Boat clouds are deleted only by the gated reconciler, through requestDelete
    async destroy() { throw new Error("Boat sandboxes are deleted only by the retention reconciler."); },
  };
  return provider;
}
