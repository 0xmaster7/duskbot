// The managed cloud backend the account service plugs in (apps/dashboard/server/clouds/managed.ts): one machine per cloud at
// the provider, its lifecycle, backups, retention and the stray-machine sweep.
// The provider's API key, backup storage and backup secret exist only in this process.
import { hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP_KINDS, type CloudDesktopView } from "../../../shared/billing-api.ts";
import type { StoredSubscription } from "../../dashboard/server/billing/store.ts";
import type { ManagedCloud, ManagedCloudContext, ManagedCloudFactory } from "../../dashboard/server/clouds/managed.ts";
import { parseSealKey } from "../../dashboard/server/clouds/seal.ts";
import type { DesktopPlan, StoredCloud } from "../../dashboard/server/clouds/types.ts";
import { createAudit, type Audit, type AuditEntry } from "./audit.ts";
import { boatBackupKey, createBackupStore, type BackupStore } from "./backups.ts";
import { boatScope, createBoatProvider, type BoatProvider, type BoatSize } from "./boat.ts";
import { guardBackupSecret } from "./key-guard.ts";
import { createBoatLifecycle, freshBoatState, managedSettingsFromEnv, type BoatSettings } from "./lifecycle.ts";
import { entitlementOf, noticeText, type Entitlement, type NoticeKind } from "./retention.ts";
import { createBoatSweep } from "./sweep.ts";
import "./state.ts";

export interface ManagedCloudDeps {
  provider: BoatProvider;
  backups: BackupStore;
  audit: Audit;
  settings: BoatSettings;
  kinds: ReadonlyArray<DesktopPlan["kind"]>;
  /** this service's backup secret; never on a machine */
  backupSecret: Buffer;
  /** the secret the backups were sealed with, to seal them again after a deliberate change */
  previousBackupSecret?: Buffer | null;
  /** the billing system of record, read fresh at every decision */
  entitlement(cloud: StoredCloud): Entitlement;
  notify(cloud: StoredCloud, kind: NoticeKind, at: number | null, link?: string): void;
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
      const lifecycle = createBoatLifecycle({ ...deps, home: ctx.home, now: ctx.now, save: ctx.save, stored: ctx.stored, unseal: ctx.unseal, seal: ctx.seal,
        dashboardUrl: ctx.dashboardUrl, adminOrigin: ctx.adminOrigin, removeWorkspace: ctx.removeWorkspace  });
      const sweep = createBoatSweep({ dataDir: ctx.dataDir, provider: deps.provider, audit: deps.audit, retentionDays: deps.settings.retentionDays, now: ctx.now });
      return {
        kinds: deps.kinds,
        fresh: () => freshBoatState(),
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
        close: () => sweep.close(),
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
  const legacy = /^OMB_BOAT(?=_|$)/, out: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(env)) if (legacy.test(key)) { const name = key.replace(legacy, "OMB_MANAGED"); if (out[name] === undefined) out[name] = value; }
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

/** OMB_MANAGED=1 attaches the backend; anything else leaves the account service without one */
export function managedCloudFromEnv(source: NodeJS.ProcessEnv, options: ManagedCloudEnvOptions): ManagedCloudFactory | null {
  const env = managedEnv(source);
  if (env.OMB_MANAGED !== undefined && env.OMB_MANAGED !== "0" && env.OMB_MANAGED !== "1") throw new Error("Invalid OMB_MANAGED.");
  if (env.OMB_MANAGED !== "1") return null;
  const required = (key: string) => { const value = env[key]; if (!value) throw new Error(`${key} is required.`); return value; };
  // the runtime key: sandbox lifecycle, commands and files on its own machines, snapshot reads for backups; never the template key
  const apiKey = required("BOAT_API_KEY");
  if (env.BOAT_TEMPLATE_API_KEY && env.BOAT_TEMPLATE_API_KEY === apiKey) throw new Error("BOAT_TEMPLATE_API_KEY must be a different key from BOAT_API_KEY.");
  if (!options.loopback) required("OMB_CLOUD_SEAL_KEY");
  const kinds = (env.OMB_MANAGED_KINDS ?? "shared_s,shared_m,dedicated").split(",").map(k => k.trim());
  if (!kinds.length || kinds.some(k => k === "none" || !(DESKTOP_KINDS as readonly string[]).includes(k))) throw new Error("Invalid OMB_MANAGED_KINDS.");
  const smallest = env.OMB_MANAGED_SMALLEST ?? "small";
  if (!["small", "default", "large", "xlarge"].includes(smallest)) throw new Error("Invalid OMB_MANAGED_SMALLEST.");
  const scope = env.OMB_MANAGED_SCOPE ?? boatScope(new URL(options.publicUrl).origin);
  // the backup secret never leaves this service: its own key, or one derived from the seal key, or (loopback only) a local file
  const backupSecret = env.OMB_MANAGED_BACKUP_KEY ? parseSealKey(env.OMB_MANAGED_BACKUP_KEY)
    : options.sealKey ? Buffer.from(hkdfSync("sha256", options.sealKey, Buffer.alloc(0), Buffer.from("omb-boat-backup-secret"), 32))
    : localSecret(join(options.dataDir, "boat-backup-secret"));
  const settings = managedSettingsFromEnv(env);
  return createManagedCloud({ kinds: kinds as Array<DesktopPlan["kind"]>, settings, backupSecret,
    previousBackupSecret: env.OMB_MANAGED_BACKUP_KEY_PREVIOUS ? parseSealKey(env.OMB_MANAGED_BACKUP_KEY_PREVIOUS) : null,
    provider: createBoatProvider({ apiKey, baseUrl: env.BOAT_BASE_URL, scope, fetch: options.fetch, smallest: smallest as BoatSize }),
    backups: createBackupStore({ dir: env.OMB_MANAGED_BACKUP_DIR || join(options.dataDir, "boat-backups"), now: options.now }),
    audit: createAudit({ dataDir: options.dataDir, now: options.now, alert: options.alert }),
    entitlement: cloud => entitlementOf(options.subscriptions(), cloud, options.now()),
    notify: (cloud, kind, at, link) => options.mail?.(cloud, noticeText(kind, { name: cloud.name, at, dashboardUrl: options.publicUrl, link })) });
}
