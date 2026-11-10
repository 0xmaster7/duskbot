// The managed cloud backend the account service plugs in (apps/dashboard/server/clouds/managed.ts): one machine per cloud at
// the provider, its lifecycle, backups, retention, the stray-machine sweep, the machine claim and the edge's route lookup.
// The provider's API key, backup storage and backup secret exist only in this process.
import "../../../electron/legacy-names.mjs";
import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DESKTOP_KINDS, type CloudDesktopView } from "../../../shared/billing-api.ts";
import type { StoredSubscription } from "../../dashboard/server/billing/store.ts";
import type { ManagedCloud, ManagedCloudContext, ManagedCloudFactory, ManagedCloudRoutesContext } from "../../dashboard/server/clouds/managed.ts";
import { parseSealKey } from "../../dashboard/server/clouds/seal.ts";
import type { DesktopPlan, StoredCloud } from "../../dashboard/server/clouds/types.ts";
import { createAudit, type Audit, type AuditEntry } from "./audit.ts";
import { boatBackupKey, createBackupStore, type BackupStore } from "./backups.ts";
import { BOAT_PLANS, boatCostProfile, boatScope, createBoatProvider, type BoatPlan, type BoatSize } from "./boat.ts";
import type { MachineProvider } from "./provider.ts";
import { BOAT_IMAGE } from "./home.ts";
import { guardBackupSecret } from "./key-guard.ts";
import { createLifecycle, freshManagedState, managedSettingsFromEnv, type ManagedSettings } from "./lifecycle.ts";
import { entitlementOf, noticeText, type Entitlement, type NoticeKind } from "./retention.ts";
import { parseReleaseKeys, PINNED_RELEASE_KEYS, verifyRelease, type ReleaseKey } from "./release-signing.ts";
import { createSweep } from "./sweep.ts";
import { createStartLedger } from "./starts.ts";
import { createSpendLedger } from "./spend.ts";
import { createPowerPolicy, DEFAULT_POLICY, type PolicyParams } from "./power/policy.ts";
import type { ProviderCostProfile } from "./power/cost.ts";
import "./state.ts";

export interface ManagedCloudDeps {
  provider: MachineProvider;
  backups: BackupStore;
  audit: Audit;
  settings: ManagedSettings;
  kinds: ReadonlyArray<DesktopPlan["kind"]>;
  /** this service's backup secret; never on a machine */
  backupSecret: Buffer;
  /** the secret the backups were sealed with, to seal them again after a deliberate change */
  previousBackupSecret?: Buffer | null;
  /** the billing system of record, read fresh at every decision */
  entitlement(cloud: StoredCloud): Entitlement;
  notify(cloud: StoredCloud, kind: NoticeKind, at: number | null, link?: string): void;
  /** public keys a release must be signed with (the pinned ones unless a test says otherwise) */
  releaseKeys?: readonly ReleaseKey[];
  /** the bearer the edge proxy presents to look up a label's upstream (DUSK_MANAGED_EDGE_TOKEN) */
  edgeToken?: string | null;
  /** keys the opaque public labels; defaults to one derived from the backup secret */
  labelKey?: Buffer;
  /** the operator's alert, also used when the day's provider starts approach the included count */
  alert?(entry: AuditEntry): void;
  /** the provider's prices and start pool, for the ledger, the policy and the rails (the $20 plan's pool, scaled to DUSK_MANAGED_DAILY_STARTS, by default) */
  costProfile?: ProviderCostProfile;
  /** the power policy's settings (the tuned defaults otherwise) */
  policy?: PolicyParams;
  /** a monotonic clock for the cost ledger, so a wall-clock jump is not taken as time passing (only with the real clock) */
  mono?: () => number;
}

/** a record written before the rename: backend "boat" and its lifecycle record under `boat` */
export function upgradeManagedRecord(cloud: StoredCloud): boolean {
  const raw = cloud as unknown as Record<string, unknown>;
  let changed = false;
  if (raw.backend === "boat") { raw.backend = "managed"; changed = true; }
  if (raw.boat !== undefined) { if (raw.managed === undefined) raw.managed = raw.boat; delete raw.boat; changed = true; }
  return changed;
}

export function createManagedCloud(deps: ManagedCloudDeps): ManagedCloudFactory {
  return {
    kinds: deps.kinds,
    upgrade: upgradeManagedRecord,
    create(ctx: ManagedCloudContext): ManagedCloud {
      const { backups, backupSecret } = deps, previous = deps.previousBackupSecret ?? null;
      const generations = () => ctx.clouds().flatMap(c => (c.managed?.backups ?? []).map(g => ({ c, g }))).filter(({ c, g }) => backups.version(c.id, g.file) === 2);
      guardBackupSecret(ctx.dataDir, backupSecret, previous, old => {
        for (const { c, g } of generations()) {
          const tar = backups.read(c.id, boatBackupKey(old, c.id), g.file);
          const record = backups.write(c.id, boatBackupKey(backupSecret, c.id), tar);
          if (!backups.read(c.id, boatBackupKey(backupSecret, c.id), record.file).equals(tar)) throw new Error("A backup did not verify after sealing it with the new secret.");
          const file = g.file;
          Object.assign(g, { file: record.file, bytes: record.bytes, sha256: record.sha256 });
          ctx.commit();
          backups.remove(c.id, file);
        }
      }, secret => {
        const newest = generations().sort((a, b) => b.g.at - a.g.at)[0];
        if (!newest) return null;
        try { backups.read(newest.c.id, boatBackupKey(secret, newest.c.id), newest.g.file); return true; } catch { return false; }
      });
      // starts, not compute, are the provider's scarce resource: counted in its rolling windows, priced by the policy, capped by the rails
      const profile = deps.costProfile ?? boatCostProfile({ plan: "20", scale: deps.settings.includedStarts / BOAT_PLANS["20"].day });
      const base = deps.policy ?? DEFAULT_POLICY;
      const params: PolicyParams = { ...base, schedule: { ...base.schedule, leadMs: deps.settings.wakeLeadMs }, rails: { ...base.rails, minIdleMs: deps.settings.idleMinutes * 60_000 } };
      const starts = createStartLedger({ dataDir: ctx.dataDir, profile, now: ctx.now,
        alert: text => { console.warn(`managed: ${text}`); deps.alert?.({ at: ctx.now(), cloudId: "fleet", action: "starts_alert", actor: "reconciler", reason: text.slice(0, 120) }); } });
      const sleepPolicy = createPowerPolicy({ profile, params, pool: () => starts.view() });
      // each home's monthly cost book: nothing is charged to a home past its ceiling (power/ceiling.ts, docs/power.md)
      const spend = createSpendLedger({ dataDir: ctx.dataDir, profile, reserveStarts: params.rails.costReserveStarts, now: ctx.now, mono: deps.mono,
        alert: (cloudId, text) => { console.warn(`managed: ALERT ${text}`); deps.alert?.({ at: ctx.now(), cloudId, action: "cost_ceiling", actor: "reconciler", reason: text.slice(0, 120) }); } });
      const lifecycle = createLifecycle({ ...deps, image: BOAT_IMAGE, starts, spend, sleepPolicy, costProfile: profile, rails: params.rails, home: ctx.home, now: ctx.now, save: ctx.save, stored: ctx.stored, unseal: ctx.unseal, seal: ctx.seal,
        dashboardUrl: ctx.dashboardUrl, adminOrigin: ctx.adminOrigin, removeWorkspace: ctx.removeWorkspace, clouds: ctx.clouds, entitle: ctx.entitlement,
        releaseKeys: deps.releaseKeys ?? PINNED_RELEASE_KEYS, labelKey: deps.labelKey ?? Buffer.from(hkdfSync("sha256", backupSecret, Buffer.alloc(0), Buffer.from("omb-managed-label"), 32))  });
      const sweep = createSweep({ dataDir: ctx.dataDir, file: "boat-sweep.json", provider: deps.provider, audit: deps.audit, retentionDays: deps.settings.retentionDays, now: ctx.now });
      const claimLimits = new Map<string, { count: number; until: number }>();
      /** failed redemptions per address: 30 per 15 minutes; a machine's own successful boot never counts */
      function limited(key: string): boolean {
        const now = ctx.now();
        for (const [k, item] of claimLimits) if (item.until <= now) claimLimits.delete(k);
        return (claimLimits.get(key)?.count ?? 0) >= 30;
      }
      function failed(key: string) {
        const now = ctx.now(), item = claimLimits.get(key);
        if (!item || item.until <= now) claimLimits.set(key, { count: 1, until: now + 15 * 60_000 }); else item.count++;
      }
      const digest = (value: string) => createHash("sha256").update(value).digest();
      async function handle(req: IncomingMessage, res: ServerResponse, url: URL, routes: ManagedCloudRoutesContext): Promise<boolean> {
        if (url.pathname === "/v1/managed/claims/redeem") {
          if (req.method !== "POST") { routes.json(res, 405, { error: "method_not_allowed" }); return true; }
          // the claim is the credential; a guesser gets 30 wrong tries per address per 15 minutes
          const address = `claim:${routes.clientIp(req)}`;
          if (limited(address)) { res.setHeader("retry-after", "60"); routes.json(res, 429, { error: "rate_limited" }); return true; }
          const body = await routes.readJson(req).catch(() => ({} as Record<string, unknown>));
          const answer = lifecycle.redeemClaim(body.cloud, body.claim);
          if (!answer) { failed(address); routes.json(res, 403, { error: "invalid_claim" }); return true; }
          res.setHeader("cache-control", "no-store");
          routes.json(res, 200, answer);
          return true;
        }
        if (url.pathname === "/v1/managed/edge/route") {
          const want = deps.edgeToken ? `Bearer ${deps.edgeToken}` : null;
          // only the edge proxy may ask; to anyone else the route does not exist
          if (req.method !== "GET" || !want || !digest(String(req.headers.authorization ?? "")).equals(digest(want))) { routes.json(res, 404, { error: "not_found" }); return true; }
          const route = lifecycle.edgeRoute(url.searchParams.get("label") ?? "");
          if (!route) { routes.json(res, 404, { error: "not_found" }); return true; }
          res.setHeader("cache-control", "no-store");
          routes.json(res, 200, route);
          return true;
        }
        if (url.pathname === "/v1/managed/edge/wake") {
          const want = deps.edgeToken ? `Bearer ${deps.edgeToken}` : null;
          if (req.method !== "POST" || !want || !digest(String(req.headers.authorization ?? "")).equals(digest(want))) { routes.json(res, 404, { error: "not_found" }); return true; }
          const reason = url.searchParams.get("reason") === "webhook" ? "webhook" : "client";
          const answer = lifecycle.edgeWake(url.searchParams.get("label") ?? "", reason);
          if (answer.status === 202) ctx.kick?.(lifecycle.cloudOfLabel(url.searchParams.get("label") ?? ""));
          res.setHeader("cache-control", "no-store");
          if (answer.status === 429) res.setHeader("retry-after", "300");
          routes.json(res, answer.status, { ok: answer.ok, retryAfterMs: answer.ok ? 1_000 : null });
          return true;
        }
        return false;
      }
      return {
        kinds: deps.kinds,
        fresh: () => freshManagedState(),
        reconcile: c => lifecycle.reconcile(c),
        retryAt: (c, error) => lifecycle.retryAt(c, error),
        view(c): Partial<CloudDesktopView> {
          const m = c.managed, retained = lifecycle.verdict(c);
          return { provider: "managed", lastBackupAt: m?.backups.at(-1)?.at ?? null,
            deleteScheduledAt: m?.deleteRequest?.confirmedAt && m.deleteRequest.cancelledAt === null ? m.deleteRequest.executeAfter : null,
            deleteAskedAt: m?.deleteRequest && !m.deleteRequest.confirmedAt && m.deleteRequest.cancelledAt === null && (m.deleteRequest.tokenExpiresAt ?? 0) > ctx.now() ? m.deleteRequest.requestedAt : null,
            ...(c.status !== "destroyed" ? { destroyAt: retained.earliestAt } : {}) };
        },
        afterPass: clouds => sweep.sweep(clouds),
        requestDelete: (c, link) => lifecycle.requestDelete(c, link),
        confirmDelete: (c, token) => lifecycle.confirmDelete(c, token),
        cancelDelete: c => lifecycle.cancelDelete(c),
        resizeNow: c => lifecycle.resizeNow(c),
        resizing: c => lifecycle.resizing(c),
        setHold: (c, hold) => lifecycle.setHold(c, hold),
        handle,
        close: () => { sweep.close(); starts.close(); },
      };
    },
  };
}

/** a loopback service's own backup secret, kept beside its data */
function localSecret(path: string): Buffer {
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
  return parseSealKey(readFileSync(path, "utf8").trim());
}

/** older deployments named every setting after the provider; those names still work, the neutral one wins */
export function managedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const legacy = /^DUSK_BOAT(?=_|$)/, out: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(env)) if (legacy.test(key)) { const name = key.replace(legacy, "DUSK_MANAGED"); if (out[name] === undefined) out[name] = value; }
  return out;
}

export interface ManagedCloudEnvOptions {
  dataDir: string;
  publicUrl: string;
  loopback: boolean;
  sealKey: Buffer | null;
  now(): number;
  fetch?: typeof fetch;
  /** the billing store's subscriptions, read at the moment of each decision */
  subscriptions(): readonly StoredSubscription[];
  /** an owner's letter (retention, recovery, deletion); delivery failures are logged, never thrown */
  mail?(cloud: StoredCloud, letter: { subject: string; text: string }): void;
  /** the operator's alert for every deletion action */
  alert?(entry: AuditEntry): void;
}

/** DUSK_MANAGED=1 attaches the backend; anything else leaves the account service without one */
export function managedCloudFromEnv(source: NodeJS.ProcessEnv, options: ManagedCloudEnvOptions): ManagedCloudFactory | null {
  const env = managedEnv(source);
  if (env.DUSK_MANAGED !== undefined && env.DUSK_MANAGED !== "0" && env.DUSK_MANAGED !== "1") throw new Error("Invalid DUSK_MANAGED.");
  if (env.DUSK_MANAGED !== "1") return null;
  const required = (key: string) => { const value = env[key]; if (!value) throw new Error(`${key} is required.`); return value; };
  // the runtime key: sandbox lifecycle, commands and files on its own machines, snapshot reads for backups; never the template key
  const apiKey = required("BOAT_API_KEY");
  if (env.BOAT_TEMPLATE_API_KEY && env.BOAT_TEMPLATE_API_KEY === apiKey) throw new Error("BOAT_TEMPLATE_API_KEY must be a different key from BOAT_API_KEY.");
  // the e2e harness's service is on a name no machine resolves and nobody uses (.invalid or .test): it may relax these
  const harness = env.DUSK_MANAGED_TEST_HARNESS === "1" && /\.(?:invalid|test)$/.test(new URL(options.publicUrl).hostname);
  const lenient = options.loopback || harness;
  // a service people use: user-facing names on our own domain behind the edge, and signed releases only
  if (!lenient) { required("DUSK_CLOUD_SEAL_KEY"); required("DUSK_MANAGED_PUBLIC_DOMAIN"); required("DUSK_MANAGED_EDGE_TOKEN"); }
  const edgeToken = env.DUSK_MANAGED_EDGE_TOKEN || null;
  if (edgeToken !== null && edgeToken.length < 32) throw new Error("DUSK_MANAGED_EDGE_TOKEN must be at least 32 characters.");
  const kinds = (env.DUSK_MANAGED_KINDS ?? "shared_s,shared_m,dedicated").split(",").map(k => k.trim());
  if (!kinds.length || kinds.some(k => k === "none" || !(DESKTOP_KINDS as readonly string[]).includes(k))) throw new Error("Invalid DUSK_MANAGED_KINDS.");
  const smallest = env.DUSK_MANAGED_SMALLEST ?? "small";
  if (!["small", "default", "large", "xlarge"].includes(smallest)) throw new Error("Invalid DUSK_MANAGED_SMALLEST.");
  const scope = env.DUSK_MANAGED_SCOPE ?? boatScope(new URL(options.publicUrl).origin);
  // the backup secret never leaves this service: its own key, or one derived from the seal key, or (loopback only) a local file
  const backupSecret = env.DUSK_MANAGED_BACKUP_KEY ? parseSealKey(env.DUSK_MANAGED_BACKUP_KEY)
    : options.sealKey ? Buffer.from(hkdfSync("sha256", options.sealKey, Buffer.alloc(0), Buffer.from("omb-boat-backup-secret"), 32))
    : localSecret(join(options.dataDir, "boat-backup-secret"));
  const settings = managedSettingsFromEnv(env, { loopback: lenient });
  // the provider plan whose start pool this account has; DUSK_MANAGED_DAILY_STARTS scales it (seats, a custom plan)
  const plan = env.DUSK_MANAGED_PROVIDER_PLAN ?? "20";
  if (!Object.hasOwn(BOAT_PLANS, plan)) throw new Error("Invalid DUSK_MANAGED_PROVIDER_PLAN.");
  const daily = env.DUSK_MANAGED_DAILY_STARTS ? settings.includedStarts : BOAT_PLANS[plan as BoatPlan].day;
  const costProfile = boatCostProfile({ plan: plan as BoatPlan, scale: daily / BOAT_PLANS[plan as BoatPlan].day });
  const releaseKeys = [...PINNED_RELEASE_KEYS, ...parseReleaseKeys(env.DUSK_RELEASE_PUBLIC_KEYS)];
  if (settings.package?.signature) verifyRelease(settings.package.signature, { kind: "home-package", sha256: settings.package.sha256 }, releaseKeys);
  else if (settings.requireSigned && settings.package) throw new Error("DUSK_MANAGED_HOME_PACKAGE_SIGNATURE is required: a home package must be signed by a release key.");
  if (settings.templateSignature) verifyRelease(settings.templateSignature, { kind: "template", name: settings.template ?? "" }, releaseKeys);
  else if (settings.requireSigned && settings.template) throw new Error("DUSK_MANAGED_TEMPLATE_SIGNATURE is required: a template must be signed by a release key.");
  return createManagedCloud({ kinds: kinds as Array<DesktopPlan["kind"]>, settings: { ...settings, includedStarts: daily }, costProfile, backupSecret, releaseKeys, edgeToken,
    previousBackupSecret: env.DUSK_MANAGED_BACKUP_KEY_PREVIOUS ? parseSealKey(env.DUSK_MANAGED_BACKUP_KEY_PREVIOUS) : null,
    provider: createBoatProvider({ apiKey, baseUrl: env.BOAT_BASE_URL, scope, fetch: options.fetch, smallest: smallest as BoatSize }),
    backups: createBackupStore({ dir: env.DUSK_MANAGED_BACKUP_DIR || join(options.dataDir, "boat-backups"), now: options.now }),
    audit: createAudit({ dataDir: options.dataDir, now: options.now, alert: options.alert }),
    alert: options.alert,
    mono: options.now === Date.now ? () => performance.now() : undefined,
    entitlement: cloud => entitlementOf(options.subscriptions(), cloud, options.now()),
    notify: (cloud, kind, at, link) => options.mail?.(cloud, noticeText(kind, { name: cloud.name, at, dashboardUrl: options.publicUrl, link })) });
}
