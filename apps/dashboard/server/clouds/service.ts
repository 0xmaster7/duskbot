import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLOUD_STATUSES, CLOUD_SWATCHES } from "../../../../shared/billing-api.ts";
import type { CloudDesktopView, MachineSpec } from "../../../../shared/billing-api.ts";
import { createJsonStore } from "../billing/json-store.ts";
import { dedicatedUserData, linkKeys, originFor, poolBootstrap } from "./bootstrap.ts";
import { PoolFullError } from "./pool.ts";
import { RetryableCloudError } from "./http.ts";
import type { createSealer } from "./seal.ts";
import type { CloudProvider, CloudsService, DesktopPlan, HomeClient, SlotQuota, StoredCloud } from "./types.ts";
import { createBoatLifecycle, freshBoatState, type BoatLifecycle, type BoatLifecycleDeps } from "./boat-lifecycle.ts";
import { createBoatSweep } from "./boat-sweep.ts";
import { lockDataDir } from "../data-dir-lock.ts";

export class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message = "Cloud request failed.") { super(message); this.name = "CloudError"; this.status = status; this.code = code; }
}
export interface CloudsConfig {
  configured?: { pool: boolean; dedicated: boolean };
  adminOrigin: string;
  dashboardUrl: string;
  /** the Cloud home container image dedicated machines run */
  image: string;
  originTemplate?: string;
  poolQuota(kind: DesktopPlan["kind"], spec: MachineSpec, botComputers: number | null): SlotQuota;
  maxAttempts?: number;
}
export interface CloudWorkspaces {
  register(input: { accountId: string; name: string; publicKey: string }): string;
  lastReportAt(workspaceId: string): number | null;
  remove(workspaceId: string): void;
}
export interface CloudsServiceOptions {
  dataDir: string;
  providers: { pool: CloudProvider & { suspend(id: string, reason: string): Promise<void>; resume(id: string): Promise<void> }; dedicated: CloudProvider };
  home: HomeClient;
  sealer: ReturnType<typeof createSealer>;
  workspaces: CloudWorkspaces;
  config: CloudsConfig;
  now?: () => number;
  random?: (size: number) => Buffer;
  /** Boat runs these desktop kinds (boat-lifecycle.ts); every other cloud keeps its placement's provider */
  boat?: Omit<BoatLifecycleDeps, "home" | "unseal" | "seal" | "dashboardUrl" | "adminOrigin" | "removeWorkspace" | "now" | "save" | "stored"> & { kinds: ReadonlyArray<DesktopPlan["kind"]> };
}
interface State { v: 1; clouds: StoredCloud[] }
const sameSpec = (a: MachineSpec, b: MachineSpec) => a.vcpu === b.vcpu && a.ramGb === b.ramGb && a.diskGb === b.diskGb;
const sameQuota = (a: SlotQuota | undefined, b: SlotQuota) => a && (Object.keys(b) as Array<keyof SlotQuota>).every(k => a[k] === b[k]);

export function createCloudsService(options: CloudsServiceOptions): CloudsService {
  const { providers, sealer, workspaces, config, home } = options, now = options.now ?? Date.now, random = options.random ?? randomBytes;
  const unlock = lockDataDir(options.dataDir);
  const store = createJsonStore<State>(join(options.dataDir, "clouds.json"), () => ({ v: 1, clouds: [] }), (v): v is State => {
    if (!v || typeof v !== "object") return false;
    const state = v as State;
    return state.v === 1 && Array.isArray(state.clouds) && state.clouds.every(c => c && /^c[0-9a-f]{24}$/.test(c.id) && CLOUD_STATUSES.includes(c.status) && typeof c.accountId === "string");
  });
  for (const cloud of store.state.clouds) for (const field of ["bootstrapSecret", "sealedLinkPrivateKey"] as const) {
    const value = cloud[field];
    if (value?.startsWith("plain.")) {
      const sealed = sealer.seal(value.slice(6));
      if (sealed !== value) { cloud[field] = sealed; store.commit(); }
    }
  }
  const powerChanges = new Map<string, number[]>();
  let pending = Promise.resolve(), reconciling: Promise<void> | null = null, closed = false;
  function exclusive<T>(fn: () => Promise<T>): Promise<T> { const result = pending.then(fn); pending = result.then(() => {}, () => {}); return result; }
  function save(c: StoredCloud) { c.updatedAt = now(); store.commit(); }
  function get(id: string) { return store.state.clouds.find(c => c.id === id) ?? null; }
  function requireCloud(id: string) { const cloud = get(id); if (!cloud) throw new CloudError(404, "not_found"); return cloud; }
  function requireOwned(accountId: string, id: string) { const cloud = get(id); if (!cloud || cloud.accountId !== accountId) throw new CloudError(404, "not_found"); return cloud; }
  function applyPlan(c: StoredCloud, plan: DesktopPlan) {
    if (c.placement !== plan.placement) throw new CloudError(409, "placement_change_unavailable");
    c.kind = plan.kind; c.botComputers = plan.botComputers;
    c.desiredSpec = { ...plan.spec, diskGb: Math.max(c.spec.diskGb, plan.spec.diskGb) };
  }
  function kick() { void service.reconcile().catch(() => {}); }
  function retry(c: StoredCloud, error: unknown) {
    if (c.backend === "boat" && c.status !== "provisioning") {
      c.attempts++; c.nextAttemptAt = now() + Math.min(15_000 * 2 ** Math.min(c.attempts - 1, 6), 900_000);
      if (c.attempts === 8) console.warn(`boat: cloud ${c.id} keeps failing its lifecycle step`);
      save(c); return;
    }
    if (error instanceof PoolFullError) {
      c.poolFullSince ??= now();
      if (c.status === "provisioning" && now() - c.poolFullSince >= 30 * 60_000) { c.status = "error"; c.error = "Setup failed. We are on it."; }
      else c.nextAttemptAt = now() + 30_000;
    } else {
      c.attempts++;
      const retryable = error instanceof RetryableCloudError || (error && typeof error === "object" && "retryable" in error && error.retryable === true);
      if (!retryable || c.attempts >= (config.maxAttempts ?? 8)) { c.status = "error"; c.error = "Setup failed. We are on it."; }
      else c.nextAttemptAt = now() + Math.min(30_000 * 2 ** (c.attempts - 1), 900_000);
    }
    if (c.suspended !== null && (c.destroyAt === null || c.destroyAt > now())) {
      c.status = "suspended";
      c.nextAttemptAt = now() + Math.min(30_000 * 2 ** Math.max(0, c.attempts - 1), 900_000);
    }
    save(c);
  }
  function viewOf(c: StoredCloud): CloudDesktopView { return { id: c.id, name: c.name, color: c.color, kind: c.kind, placement: c.placement, status: c.status === "running" && c.paymentProblem ? "payment_problem" : c.status, setupStep: c.setupStep, region: c.region, machine: { ...c.spec }, botComputers: c.botComputers, origin: c.origin, workspaceId: c.workspaceId, lastReportAt: c.workspaceId ? workspaces.lastReportAt(c.workspaceId) : null, destroyAt: c.destroyAt, error: c.error, subscriptionId: c.subscriptionId, createdAt: c.createdAt }; }
  const boat: BoatLifecycle | null = options.boat ? createBoatLifecycle({ ...options.boat, home, now, save, dashboardUrl: config.dashboardUrl, adminOrigin: config.adminOrigin,
    unseal: value => sealer.unseal(value), seal: value => sealer.seal(value), removeWorkspace: id => workspaces.remove(id),
    stored(id) {
      try { return (JSON.parse(readFileSync(join(options.dataDir, "clouds.json"), "utf8")) as State).clouds.find(c => c.id === id) ?? null; } catch { return null; }
    } }) : null;
  const sweep = options.boat ? createBoatSweep({ dataDir: options.dataDir, provider: options.boat.provider, audit: options.boat.audit, retentionDays: options.boat.settings.retentionDays, now }) : null;
  function succeeded(c: StoredCloud) { c.attempts = 0; c.nextAttemptAt = 0; c.poolFullSince = undefined; c.error = null; save(c); }
  async function reconcileCloud(c: StoredCloud) {
    if (c.backend === "boat") {
      if (!boat) { if (c.error !== "Boat is not configured.") { c.error = "Boat is not configured."; save(c); } return; }
      await boat.reconcile(c);
      if (c.status === "running" || c.status === "sleeping") succeeded(c);
      return;
    }
    const provider = providers[c.placement];
    if (c.destroyAt !== null && c.destroyAt <= now() && c.status !== "destroyed") {
      c.status = "destroying"; save(c);
      if (!c.serverId) c.serverId = (await provider.find(c.id))?.id ?? null;
      if (c.serverId) await provider.destroy(c.serverId);
      await provider.cleanup?.(c.id);
      if (c.workspaceId) workspaces.remove(c.workspaceId);
      c.destroyedOrigin = c.origin ?? c.destroyedOrigin;
      c.status = "destroyed"; c.setupStep = null; c.origin = null; c.ipv4 = null; c.bootstrapSecret = ""; c.sealedLinkPrivateKey = undefined; c.serverId = null;
      succeeded(c); return;
    }
    if (c.status === "destroyed") return;
    if (!c.ended && c.endsAt !== undefined && c.endsAt <= now()) { c.endedAt = c.endsAt; delete c.endsAt; c.ended = true; c.wantPower = "off"; save(c); }
    if (c.ended && c.status === "provisioning") {
      if (!c.serverId) c.serverId = (await provider.find(c.id))?.id ?? null;
      if (c.serverId) await provider.power(c.serverId, "off");
      c.status = "stopped"; succeeded(c); return;
    }
    if (config.configured?.[c.placement] === false) {
      c.error = "Cloud desktops are not configured."; save(c); return;
    }
    if (c.suspended !== null) {
      if (!c.suspensionApplied || c.serverId && (await provider.status(c.serverId)).state !== "off") {
        if (!c.serverId) c.serverId = (await provider.find(c.id))?.id ?? null;
        if (c.serverId) {
          if (provider.suspend) await provider.suspend(c.serverId, c.suspended);
          else await provider.power(c.serverId, "off");
        }
        c.suspensionApplied = true; c.status = "suspended"; succeeded(c);
      }
      return;
    }
    if (c.status === "checkout" || c.status === "error" || c.status === "suspended") return;
    if (c.status === "provisioning") {
      if (c.setupStep === "reserving") {
        let server = await provider.find(c.id);
        if (!server) {
          if (!c.sealedLinkPrivateKey || !c.linkPublicKey || !c.workspaceId) throw new Error("Missing cloud bootstrap.");
          const secret = sealer.unseal(c.bootstrapSecret);
          const link = { v: 1 as const, url: config.dashboardUrl, workspaceId: c.workspaceId, publicKey: c.linkPublicKey, privateKey: sealer.unseal(c.sealedLinkPrivateKey), enrolledAt: c.provisionedAt ?? now(), claimed: true };
          const common = { cloudId: c.id, adminOrigin: config.adminOrigin, secret, dashboardUrl: config.dashboardUrl, link };
          const userData = c.placement === "pool" ? poolBootstrap({ ...common, origin: "" }) : dedicatedUserData({ ...common, image: config.image, originTemplate: config.originTemplate });
          server = await provider.create({ cloudId: c.id, spec: c.spec, region: c.region, userData, ...(c.placement === "pool" ? { quota: config.poolQuota(c.kind, c.spec, c.botComputers) } : {}) });
        }
        c.serverId = server.id; c.ipv4 = server.ipv4; c.origin = server.origin ?? null;
        c.sealedLinkPrivateKey = undefined; c.appliedQuota = c.placement === "pool" ? config.poolQuota(c.kind, c.spec, c.botComputers) : undefined;
        c.setupStep = "storage"; succeeded(c); return;
      }
      if (!c.serverId) throw new Error("Missing cloud server.");
      if (c.setupStep === "storage") { c.setupStep = "starting"; save(c); return; }
      if (c.setupStep === "starting") {
        const server = await provider.status(c.serverId);
        if (server.state === "missing" || server.state === "error") throw new Error("Cloud server unavailable.");
        c.ipv4 = server.ipv4;
        if (server.state === "running") {
          if (c.placement === "dedicated" && server.ipv4) c.origin = originFor(config.originTemplate, { ipv4: server.ipv4, cloudId: c.id });
          else if (c.placement === "pool") c.origin = server.origin ?? c.origin ?? (await provider.find(c.id))?.origin ?? null;
          if (c.origin) c.setupStep = "checking";
        }
        if (now() - (c.provisionedAt ?? c.createdAt) >= 30 * 60_000 && c.setupStep === "starting") throw new RetryableCloudError();
        succeeded(c); return;
      }
      if (!c.origin || !(await home.healthy(c.origin, sealer.unseal(c.bootstrapSecret)))) throw new RetryableCloudError();
      c.status = "running"; c.setupStep = null; c.lastCheckedAt = now(); c.powerSince = now(); succeeded(c); return;
    }
    if (!c.serverId) return;
    const desiredSpec = { ...c.desiredSpec };
    const quota = c.placement === "pool" ? config.poolQuota(c.kind, desiredSpec, c.botComputers) : undefined;
    if (!sameSpec(c.spec, c.desiredSpec) || (quota && !sameQuota(c.appliedQuota, quota)) || c.resizeStage) {
      if (c.placement === "pool") {
        await provider.resize(c.serverId, desiredSpec, quota); c.spec = desiredSpec; c.appliedQuota = quota;
      } else {
        const state = await provider.status(c.serverId);
        if (state.state === "missing" || state.state === "error") throw new Error("Cloud server unavailable.");
        if (!c.resizeStage) c.resizeStage = "off";
        if (c.resizeStage === "off") {
          if (state.state !== "off") { if (state.state !== "stopping") await provider.power(c.serverId, "off"); save(c); return; }
          c.resizeStage = "resize"; save(c);
        }
        if (c.resizeStage === "resize") { await provider.resize(c.serverId, desiredSpec); c.spec = desiredSpec; c.resizeStage = "on"; save(c); return; }
        if (c.resizeStage === "on") {
          if (c.wantPower === "on" && state.state !== "running") { if (state.state === "off") await provider.power(c.serverId, "on"); save(c); return; }
          c.resizeStage = undefined;
        }
      }
      succeeded(c);
    }
    const needsPower = (c.wantPower === "off" && c.status !== "stopped") || (c.wantPower === "on" && c.status === "stopped");
    if (needsPower) {
      const action = c.wantPower;
      await provider.power(c.serverId, action); c.status = action === "on" ? "running" : "stopped"; c.powerSince = now(); succeeded(c);
    }
    if (now() - (c.lastCheckedAt ?? 0) >= 300_000) {
      const state = await provider.status(c.serverId); c.lastCheckedAt = now();
      if (state.state === "missing" || state.state === "error") throw new Error("Cloud server unavailable.");
      succeeded(c);
    }
  }
  const service: CloudsService = {
    boat,
    order(input) {
      const id = input.id ?? `c${random(12).toString("hex")}`;
      const existing = get(id);
      if (input.id && existing?.accountId === input.accountId) return existing;
      if (!/^c[0-9a-f]{24}$/.test(id) || get(id)) throw new Error("Unable to allocate cloud id.");
      const cloud: StoredCloud = { id, accountId: input.accountId, name: input.name, color: input.color, kind: input.kind, placement: input.placement, subscriptionId: null, spec: { ...input.spec }, desiredSpec: { ...input.spec }, region: input.region, botComputers: input.botComputers, status: "checkout", setupStep: null, wantPower: "on", serverId: null, ipv4: null, origin: null, bootstrapSecret: "", workspaceId: null, primary: !store.state.clouds.some(c => c.accountId === input.accountId && c.status !== "destroyed"), hidden: false, paymentProblem: false, suspended: null, destroyAt: null, error: null, attempts: 0, nextAttemptAt: 0, createdAt: now(), updatedAt: now(), powerSince: now() };
      store.state.clouds.push(cloud); save(cloud); return cloud;
    },
    activate(id, subscriptionId, plan) {
      const c = requireCloud(id);
      if (c.status === "destroyed" || c.status === "destroying" || c.ended) return;
      if (c.subscriptionId && c.subscriptionId !== subscriptionId) throw new CloudError(409, "unavailable");
      applyPlan(c, plan); c.subscriptionId = subscriptionId;
      if (c.status !== "checkout") { save(c); return; }
      if (options.boat?.kinds.includes(plan.kind)) { c.backend = "boat"; c.boat = freshBoatState(); }
      const keys = linkKeys();
      c.workspaceId = workspaces.register({ accountId: c.accountId, name: c.name, publicKey: keys.publicKey });
      c.linkPublicKey = keys.publicKey; c.sealedLinkPrivateKey = sealer.seal(keys.privateKey); c.bootstrapSecret = sealer.seal(random(32).toString("base64url"));
      c.spec = { ...c.desiredSpec }; c.status = "provisioning"; c.setupStep = "reserving"; c.provisionedAt = now(); save(c); kick();
    },
    changePlan(id, plan) { const c = requireCloud(id); if (c.status === "destroyed" || c.status === "destroying" || c.ended) throw new CloudError(409, "unavailable"); applyPlan(c, plan); c.nextAttemptAt = 0; save(c); },
    setPaymentProblem(id, problem) { const c = requireCloud(id); c.paymentProblem = problem; save(c); },
    scheduleDestroy(id, at) { const c = requireCloud(id); if (c.status === "destroyed" || c.status === "destroying") return; c.destroyAt = c.ended && c.destroyAt !== null ? Math.min(c.destroyAt, at) : at; save(c); },
    cancelDestroy(id) { const c = requireCloud(id); if (c.status === "destroyed" || c.status === "destroying" || c.ended || c.paymentProblem || c.destroyAt !== null && c.destroyAt <= now()) return; c.destroyAt = null; save(c); },
    end(id, at, from) { const c = requireCloud(id); if (c.status === "destroyed") return;
      if (from !== undefined && from > now() && !c.ended) { c.endsAt = c.endsAt === undefined ? from : Math.min(c.endsAt, from); c.destroyAt = c.destroyAt === null ? at : Math.min(c.destroyAt, at); save(c); return; }
      delete c.endsAt; if (!c.ended) c.endedAt = now(); c.ended = true; c.wantPower = "off"; c.destroyAt = c.destroyAt === null ? at : Math.min(c.destroyAt, at); c.nextAttemptAt = 0; save(c); kick(); },
    abandon(id) { const c = requireCloud(id); if (c.status === "checkout") { c.status = "destroyed"; save(c); } },
    get,
    scrubAccount(accountId, anonId) {
      for (const cloud of store.state.clouds) if (cloud.accountId === accountId) { cloud.accountId = anonId; cloud.name = "Deleted"; cloud.suspended = cloud.suspended === null ? null : "Account deleted"; }
      store.commit();
    },
    owned(accountId, id) { const c = get(id); return c?.accountId === accountId ? c : null; },
    byWorkspace(workspaceId) { return store.state.clouds.find(c => c.workspaceId === workspaceId && c.status !== "destroyed") ?? null; },
    list(accountId, includeHidden = false) { return store.state.clouds.filter(c => c.accountId === accountId && (includeHidden || !c.hidden)).reverse().sort((a, b) => b.createdAt - a.createdAt); },
    view(c) {
      const retained = c.backend === "boat" && boat ? boat.verdict(c) : null;
      const boatView = c.backend === "boat" ? { provider: "boat" as const, lastBackupAt: c.boat?.backups.at(-1)?.at ?? null,
        deleteScheduledAt: c.boat?.deleteRequest?.confirmedAt && c.boat.deleteRequest.cancelledAt === null ? c.boat.deleteRequest.executeAfter : null } : {};
      return { ...viewOf(c), ...boatView, ...(retained && c.status !== "destroyed" ? { destroyAt: retained.earliestAt } : {}) };
    },
    rename(accountId, id, patch) {
      const c = requireOwned(accountId, id);
      if (patch.name !== undefined && (typeof patch.name !== "string" || patch.name.trim().length < 1 || patch.name.length > 40 || [...patch.name].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === "<" || ch === ">"))) throw new CloudError(400, "invalid_request");
      if (patch.color !== undefined && patch.color !== null && !CLOUD_SWATCHES.includes(patch.color)) throw new CloudError(400, "invalid_request");
      if (patch.name !== undefined) c.name = patch.name.trim(); if (patch.color !== undefined) c.color = patch.color;
      save(c); return c;
    },
    async suspend(id, reason) {
      await exclusive(async () => {
        const c = requireCloud(id); if (c.status === "destroyed" || c.status === "destroying") throw new CloudError(409, "unavailable");
        c.suspended = reason; c.status = "suspended"; c.wantPower = "off"; c.suspensionApplied = false; c.nextAttemptAt = 0; save(c);
        if (!c.serverId) c.serverId = (await providers[c.placement].find(c.id))?.id ?? null;
        if (c.serverId) { const provider = providers[c.placement]; if (provider.suspend) await provider.suspend(c.serverId, reason); else await provider.power(c.serverId, "off"); }
        c.suspensionApplied = true; save(c);
      });
    },
    async resume(id) {
      await exclusive(async () => {
        const c = requireCloud(id); if (c.status !== "suspended" || c.ended || c.destroyAt !== null && c.destroyAt <= now()) return;
        if (c.serverId) { if (c.placement === "pool") await providers.pool.resume(c.serverId); else await providers.dedicated.power(c.serverId, "on"); }
        c.suspended = null; c.suspensionApplied = undefined; c.wantPower = "on"; c.status = c.setupStep ? "provisioning" : c.serverId ? "running" : "checkout"; c.nextAttemptAt = 0; save(c);
      });
    },
    hide(accountId, id) { const c = requireOwned(accountId, id); if (!["stopped", "destroyed", "error", "checkout"].includes(c.status)) throw new CloudError(409, "not_removable"); c.hidden = true; save(c); return c; },
    async power(accountId, id, action) { const c = requireOwned(accountId, id);
      if (c.backend === "boat") {
        // each wake is a Boat start: an owner, a page or the slack edge gets 60 power changes an hour per cloud
        const recent = (powerChanges.get(c.id) ?? []).filter(t => t > now() - 3_600_000);
        if (recent.length >= 60) throw new CloudError(429, "rate_limited");
        powerChanges.set(c.id, [...recent, now()]);
      } if (!["running", "stopped", "sleeping"].includes(c.status) || c.suspended !== null || c.ended || c.destroyAt !== null && c.destroyAt <= now()) throw new CloudError(409, "unavailable"); if (action === "on" && (c.status === "stopped" || c.status === "sleeping")) c.wakeRequestedAt = now();
      c.wantPower = action; c.nextAttemptAt = 0; save(c); await service.reconcile(); if (c.wantPower === action && c.status !== (action === "on" ? "running" : "stopped") && c.status !== "error") await service.reconcile(); return c; },
    async pair(accountId, id) { const c = requireOwned(accountId, id); if (c.status !== "running" || !c.origin || c.suspended !== null || c.ended || c.destroyAt !== null && c.destroyAt <= now()) throw new CloudError(409, "unavailable"); const result = await home.pair(c.origin, sealer.unseal(c.bootstrapSecret), { label: "OpenMausBot app (Cloud)", ttlSeconds: 300 }); return { origin: c.origin, code: result.code, expiresAt: result.expiresAt }; },
    reconcile() {
      if (closed) return Promise.resolve();
      if (reconciling) return reconciling;
      reconciling = exclusive(async () => {
        for (const c of store.state.clouds) {
          if (closed) break;
          if (c.nextAttemptAt > now()) continue;
          try { await reconcileCloud(c); } catch (error) { retry(c, error); }
        }
        if (sweep && !closed) await sweep.sweep(store.state.clouds).catch(() => console.warn("boat: the orphan sweep failed; it runs again later"));
      }).finally(() => { reconciling = null; });
      return reconciling;
    },
    close() { closed = true; clearInterval(timer); store.close(); sweep?.close(); unlock(); },
  };
  const timer = setInterval(kick, 15_000); timer.unref();
  return service;
}
