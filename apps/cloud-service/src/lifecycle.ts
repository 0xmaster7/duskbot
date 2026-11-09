// A Boat-backed My Cloud from paid to deleted: provision, sleep when idle, wake for a person, a routine or Slack, back up,
// come back from a lost machine, keep a plan's data 45 days after it ended, and delete only through the verdict in
// boat-retention.ts. One step per reconcile, each safe to repeat after a crash.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { linkKeys } from "../../dashboard/server/clouds/bootstrap.ts";
import { BoatError, ProviderLimitError, type BoatProvider } from "./boat.ts";
import { backupKey, BOAT_HOME_VOLUME, BOAT_PACKAGE_FILE, BOAT_RESTORE_FILE, boatBootFile, bootContent, boatSetupScript, claimBootFile, installCommand, RESTORE_COMMAND, startCommand } from "./home.ts";
import { verifyRelease, type ReleaseKey } from "./release-signing.ts";
import { boatBackupKey, homeVolumeProblem, type BackupStore } from "./backups.ts";
import { DAY_MS, DEFAULT_DELETE_DELAY_DAYS, DEFAULT_RETENTION_DAYS, deletionVerdict, dueNotice, type Entitlement, type NoticeKind, type Verdict } from "./retention.ts";
import type { Audit, AuditActor } from "./audit.ts";
import { RetryableCloudError } from "../../dashboard/server/clouds/http.ts";
import { ManagedCloudError } from "../../dashboard/server/clouds/managed.ts";
import type { HomeClient, StoredCloud } from "../../dashboard/server/clouds/types.ts";
import type { BoatCloudState } from "./state.ts";

const MINUTE = 60_000, HOUR = 3_600_000, BACKUP_RETRY_MS = 10 * MINUTE, REFRESH_SPACING_MS = 10 * MINUTE;

export interface BoatSettings {
  /** minutes without use before a home is asked to sleep (OMB_MANAGED_IDLE_MINUTES) */
  idleMinutes: number;
  /** Boat's own auto-stop, extended while the home is up: a dead-man switch if this service stops (OMB_MANAGED_LEASE_HOURS) */
  leaseSeconds: number;
  /** a backup at most this often (OMB_MANAGED_BACKUP_HOURS) */
  backupEveryMs: number;
  /** generations kept per cloud (OMB_MANAGED_BACKUP_KEEP), at least 2 */
  backupKeep: number;
  /** wake a stopped home this long before Boat may purge its disk (OMB_MANAGED_REFRESH_DAYS) */
  refreshAfterMs: number;
  retentionDays: number;
  deleteDelayDays: number;
  /** after a retention deletion the backups stay this long more (OMB_MANAGED_BACKUP_TAIL_DAYS) */
  backupTailMs: number;
  /** a routine's run wakes its home this long before */
  wakeLeadMs: number;
  powerReadMs: number;
  template: string | null;
  /** the template's release signature (CI's release key), checked here at start and by the machine at first boot */
  templateSignature: string | null;
  /** the home's app package: a URL the sandbox downloads, or a file this service uploads; its release signature travels with it */
  package: { sha256: string; url?: string; file?: string; signature?: string } | null;
  /** machines refuse an unsigned package or template (every service that is not loopback) */
  requireSigned: boolean;
  /** user-facing origins are https://<label>.<publicDomain>, proxied to the machine (edge/worker.js); null: the provider's own */
  publicDomain: string | null;
  /** the machine redeems a one-time claim for its secrets, so the provider's API never carries them; off where no machine can reach this service */
  claims: boolean;
  maxBackupBytes: number;
  /** a sandbox Boat stops finding is lost only after this long of direct 404s and absence from the account's list */
  lostAfterMs: number;
}
export const DEFAULT_BOAT_SETTINGS: BoatSettings = {
  idleMinutes: 15, leaseSeconds: 2 * 3600, backupEveryMs: 24 * HOUR, backupKeep: 3, refreshAfterMs: 11 * DAY_MS, retentionDays: DEFAULT_RETENTION_DAYS,
  deleteDelayDays: DEFAULT_DELETE_DELAY_DAYS, backupTailMs: 30 * DAY_MS, wakeLeadMs: 5 * MINUTE, powerReadMs: MINUTE, template: null, templateSignature: null, package: null, requireSigned: false, publicDomain: null, claims: false, maxBackupBytes: 4 * 1024 ** 3, lostAfterMs: 30 * MINUTE,
};

/** settings from OMB_MANAGED_* (index.ts `managedEnv` maps the older names onto these) */
export function managedSettingsFromEnv(env: NodeJS.ProcessEnv, options: { loopback?: boolean } = {}): BoatSettings {
  const number = (name: string, min: number, max: number, fallback: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
    return value;
  };
  const sha256 = env.OMB_MANAGED_HOME_PACKAGE_SHA256;
  const pkg = env.OMB_MANAGED_HOME_PACKAGE_URL || env.OMB_MANAGED_HOME_PACKAGE_FILE
    ? { sha256: sha256 && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : (() => { throw new Error("Invalid OMB_MANAGED_HOME_PACKAGE_SHA256."); })(),
      ...(env.OMB_MANAGED_HOME_PACKAGE_URL ? { url: env.OMB_MANAGED_HOME_PACKAGE_URL } : { file: env.OMB_MANAGED_HOME_PACKAGE_FILE }) }
    : null;
  const signature = env.OMB_MANAGED_HOME_PACKAGE_SIGNATURE || (env.OMB_MANAGED_HOME_PACKAGE_SIGNATURE_FILE ? readFileSync(env.OMB_MANAGED_HOME_PACKAGE_SIGNATURE_FILE, "utf8").trim() : "");
  if (signature && pkg) Object.assign(pkg, { signature });
  const publicDomain = env.OMB_MANAGED_PUBLIC_DOMAIN || null;
  if (publicDomain !== null && !/^(?=.{4,200}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(publicDomain)) throw new Error("Invalid OMB_MANAGED_PUBLIC_DOMAIN.");
  const template = env.OMB_MANAGED_TEMPLATE || null;
  if (template !== null && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(template)) throw new Error("Invalid OMB_MANAGED_TEMPLATE.");
  if (!pkg && !template) throw new Error("A managed cloud needs OMB_MANAGED_HOME_PACKAGE_URL (or _FILE) with OMB_MANAGED_HOME_PACKAGE_SHA256, or OMB_MANAGED_TEMPLATE.");
  return { ...DEFAULT_BOAT_SETTINGS, template, package: pkg, templateSignature: env.OMB_MANAGED_TEMPLATE_SIGNATURE || null, publicDomain,
    requireSigned: !options.loopback, claims: !options.loopback,
    idleMinutes: number("OMB_MANAGED_IDLE_MINUTES", 5, 24 * 60, 15),
    leaseSeconds: number("OMB_MANAGED_LEASE_HOURS", 1, 720, 2) * 3600,
    backupEveryMs: number("OMB_MANAGED_BACKUP_HOURS", 1, 24 * 7, 24) * HOUR,
    backupKeep: number("OMB_MANAGED_BACKUP_KEEP", 2, 30, 3),
    refreshAfterMs: number("OMB_MANAGED_REFRESH_DAYS", 3, 13, 11) * DAY_MS,
    wakeLeadMs: number("OMB_MANAGED_WAKE_LEAD_MINUTES", 1, 30, 5) * MINUTE,
    retentionDays: number("OMB_MANAGED_RETENTION_DAYS", DEFAULT_RETENTION_DAYS, 3650, DEFAULT_RETENTION_DAYS),
    deleteDelayDays: number("OMB_MANAGED_DELETE_DELAY_DAYS", DEFAULT_DELETE_DELAY_DAYS, 90, DEFAULT_DELETE_DELAY_DAYS),
    backupTailMs: number("OMB_MANAGED_BACKUP_TAIL_DAYS", 7, 365, 30) * DAY_MS,
    maxBackupBytes: number("OMB_MANAGED_BACKUP_MAX_MB", 64, 64 * 1024, 4096) * 1024 * 1024,
    lostAfterMs: number("OMB_MANAGED_LOST_AFTER_MINUTES", 2, 24 * 60, 30) * MINUTE };
}

export function freshBoatState(): BoatCloudState {
  return { attempt: 0, installed: null, restoreFrom: null, restoredFrom: null, sleptAt: null, sleepReason: null, nextDueAt: null, lastPowerAt: null, busy: [], leaseAt: null,
    lastStopAt: null, wakeStartedAt: null, backups: [], lastBackupTryAt: null, backupProblem: null, endedAt: null, notices: [], deleteRequest: null, deletion: null,
    deletedAt: null, backupsDeleteAfter: null, retired: [], recoveries: 0, hold: false };
}

export interface BoatLifecycleDeps {
  provider: BoatProvider;
  backups: BackupStore;
  home: HomeClient;
  audit: Audit;
  settings: BoatSettings;
  /** the billing system of record, read fresh at every decision */
  entitlement(cloud: StoredCloud): Entitlement;
  notify(cloud: StoredCloud, kind: NoticeKind, at: number | null, link?: string): void;
  unseal(value: string): string;
  seal(value: string): string;
  dashboardUrl: string;
  adminOrigin: string;
  removeWorkspace(workspaceId: string): void;
  now(): number;
  save(cloud: StoredCloud): void;
  /** this service's backup secret (OMB_MANAGED_BACKUP_KEY, or derived from OMB_CLOUD_SEAL_KEY); never on a home */
  backupSecret: Buffer;
  /** the cloud's record as stored on disk now, re-read right before anything irreversible */
  stored(cloudId: string): StoredCloud | null;
  /** every cloud, for the claim and the edge's route lookup */
  clouds(): StoredCloud[];
  /** a fresh signed entitlement for the cloud's home, or null when none is signed */
  entitle(cloud: StoredCloud): string | null;
  /** the release keys a package or template must be signed with */
  releaseKeys: readonly ReleaseKey[];
  /** keys the opaque public labels (never on a machine) */
  labelKey: Buffer;
}

export function createBoatLifecycle(deps: BoatLifecycleDeps) {
  const { provider, settings, audit, now } = deps;
  const log = (c: StoredCloud, action: string, actor: AuditActor, reason: string, detail?: Record<string, string | number | boolean | null>) =>
    audit.record({ cloudId: c.id, action, actor, reason, serverId: c.serverId, ...(detail ? { detail } : {}) });
  const state = (c: StoredCloud): BoatCloudState => (c.managed ??= freshBoatState());
  const secret = (c: StoredCloud) => deps.unseal(c.bootstrapSecret);
  const keyOf = (c: StoredCloud) => boatBackupKey(deps.backupSecret, c.id);
  const legacyKeyOf = (c: StoredCloud) => { try { return c.bootstrapSecret ? backupKey(secret(c)) : undefined; } catch { return undefined; } };
  /** where this service reaches the home: the machine's own hosted URL, never through the public proxy */
  const homeOrigin = (c: StoredCloud) => state(c).upstream ?? c.origin!;
  const label = (c: StoredCloud) => (state(c).label ??= `d${createHmac("sha256", deps.labelKey).update(`omb-managed-label:${c.id}`).digest("hex").slice(0, 20)}`);
  /** the user-facing origin for a machine's hosted URL: ours when a public domain is set */
  function publish(c: StoredCloud, upstream: string) {
    const b = state(c);
    b.upstream = upstream;
    c.origin = settings.publicDomain ? `https://${label(c)}.${settings.publicDomain}` : upstream;
  }
  const templatePackage = (() => {
    if (!settings.template || !settings.templateSignature) return null;
    try { return verifyRelease(settings.templateSignature, { kind: "template", name: settings.template }, deps.releaseKeys).version; } catch { return null; }
  })();
  // the provider purges a disk 14 days after its stop, and starts are budgeted per day: one keep-alive start per 10
  // minutes across the deployment, the oldest stopped disk first (144 a day at most). A disk whose refresh keeps not
  // happening holds the head for 30 minutes at most, so one stuck cloud never starves the others.
  let lastRefreshAt = 0;
  const heads = new Map<string, number>();
  /** whether this cloud's own disk would be refreshed now, by the same rules its reconcile applies */
  function refreshEligible(x: StoredCloud): boolean {
    const m = x.managed;
    if (!x.backend || !x.serverId || !m || m.lastStopAt == null || m.hold || x.suspended !== null || x.wantPower === "on" || m.deletion
      || !["sleeping", "stopped"].includes(x.status) || now() - m.lastStopAt < settings.refreshAfterMs) return false;
    if (deps.entitlement(x).active) return true;
    const verdict = verdictFor(x);
    return verdict.earliestAt !== null && verdict.earliestAt - now() > DAY_MS;
  }
  function mayRefresh(c: StoredCloud, stoppedAt: number | null, retired = false): boolean {
    if (stoppedAt === null || now() - stoppedAt < settings.refreshAfterMs || now() - lastRefreshAt < REFRESH_SPACING_MS) return false;
    if (!retired) {
      const mine = state(c).lastStopAt ?? stoppedAt;
      const older = deps.clouds().filter(x => x.id !== c.id && refreshEligible(x) && (x.managed!.lastStopAt ?? Infinity) < mine)
        .sort((x, y) => (x.managed!.lastStopAt ?? 0) - (y.managed!.lastStopAt ?? 0))[0];
      if (older) {
        const since = heads.get(older.id) ?? now();
        heads.set(older.id, since);
        if (now() - since < 30 * MINUTE) return false;
      }
    }
    heads.delete(c.id);
    lastRefreshAt = now();
    return true;
  }
  /** a stop the provider could not finish (its pre-stop hook timed out, say) leaves the machine up with the stop failing:
   *  it is stopping, never awake, never started again by us and never deleted; past 15 minutes the operator hears */
  function stopFailing(c: StoredCloud, failing: boolean): boolean {
    const b = state(c);
    if (!failing) { if (b.stopFailingSince) { log(c, "stop_recovered", "reconciler", "provider"); b.stopFailingSince = null; b.stopFailingAlerted = false; deps.save(c); } return false; }
    if (!b.stopFailingSince) { b.stopFailingSince = now(); log(c, "stop_failing", "reconciler", "provider"); }
    else if (now() - b.stopFailingSince >= 15 * MINUTE && !b.stopFailingAlerted) {
      b.stopFailingAlerted = true; log(c, "stop_failing_long", "reconciler", "operator_decides");
      console.warn(`managed: ALERT cloud ${c.id}: its machine has failed to stop for 15 minutes; it is left as it is`);
    }
    c.nextAttemptAt = now() + 30_000; deps.save(c);
    return true;
  }
  /** a hosted home serves no client without a fresh entitlement: pushed when it comes up, refreshed hourly */
  async function entitle(c: StoredCloud, force: boolean) {
    if (!deps.home.entitle || (!force && c.entitledAt !== undefined && now() - c.entitledAt < HOUR)) return;
    const token = deps.entitle(c);
    if (!token) return;
    try { await deps.home.entitle(homeOrigin(c), secret(c), token); }
    catch { throw new RetryableCloudError("Cloud home refused its entitlement."); }
    c.entitledAt = now(); deps.save(c);
  }
  const latestVerified = (b: BoatCloudState) => [...b.backups].reverse().find(g => g.verifiedAt !== null) ?? null;
  function notice(c: StoredCloud, kind: NoticeKind, at: number | null, link?: string) {
    const b = state(c);
    if (["ended", "left_30", "left_7", "left_1", "deleted"].includes(kind) && b.notices.some(n => n.kind === kind)) return;
    b.notices.push({ kind, at: now() });
    deps.save(c);
    try { deps.notify(c, kind, at, link); } catch { console.warn(`boat: notice ${kind} for ${c.id} was not delivered`); }
  }

  function verdictFor(c: StoredCloud, given = deps.entitlement(c)): Verdict {
    const b = state(c), final = latestVerified(b);
    // a plan that ended with no period end on record: the clock runs from when this service first saw it end
    const entitlement = !given.active && given.until === null && given.known && b.endedAt !== null ? { ...given, until: b.endedAt } : given;
    return deletionVerdict({ now: now(), retentionDays: settings.retentionDays, entitlement, finalBackup: final ? { at: final.snapshotAt, verifiedAt: final.verifiedAt } : null,
      lastStopAt: b.lastStopAt, ownerRequest: b.deleteRequest, hold: b.hold || c.suspended !== null && c.suspended !== "Account deleted" });
  }

  /** a backup of the volume from the newest snapshot of a stopped (or, past twice the interval, running) sandbox */
  async function backup(c: StoredCloud, reason: string, serverId: string | null = c.serverId, keep = false): Promise<boolean> {
    const b = state(c);
    if (!serverId) return false;
    b.lastBackupTryAt = now(); deps.save(c);
    const snapshot = await provider.latestSnapshot(serverId);
    if (!snapshot) { b.backupProblem = "no_snapshot"; deps.save(c); return false; }
    if (b.backups.some(g => g.snapshotAt >= snapshot.at && g.verifiedAt !== null && (g.source ?? c.serverId) === serverId)) return true;
    let stream: ReadableStream<Uint8Array>;
    try { stream = await provider.snapshotTar(snapshot.id, BOAT_HOME_VOLUME); }
    catch (error) { b.backupProblem = "snapshot_read"; deps.save(c); log(c, "backup_failed", "reconciler", "snapshot_read"); throw error; }
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > settings.maxBackupBytes) { await reader.cancel(); b.backupProblem = "too_large"; deps.save(c); log(c, "backup_skipped", "reconciler", "too_large"); return false; }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const tar = Buffer.concat(chunks), problem = homeVolumeProblem(tar, c.id);
    if (problem) { b.backupProblem = problem; deps.save(c); log(c, "backup_refused", "reconciler", problem); return false; }
    const key = keyOf(c), record = deps.backups.write(c.id, key, tar);
    // restorable means: it opens with this cloud's key and is still this cloud's volume
    const verified = homeVolumeProblem(deps.backups.read(c.id, key, record.file), c.id) === null && deps.backups.sha256(c.id, record.file) === record.sha256;
    b.backups.push({ ...record, verifiedAt: verified ? now() : null, snapshotAt: snapshot.at, ...(keep ? { keep: true, source: serverId } : {}) });
    b.backupProblem = verified ? null : "unverified";
    log(c, "backup", "reconciler", reason, { file: record.file, bytes: record.bytes, verified });
    // keep the newest `backupKeep` verified generations, and the newest one at least a week older than the newest, so a home
    // that wiped its own data cannot push every good copy out within a few days
    const verifiedOnes = b.backups.filter(g => g.verifiedAt !== null && !g.keep), newest = verifiedOnes.at(-1);
    const pinned = newest ? [...verifiedOnes].reverse().find(g => newest.snapshotAt - g.snapshotAt >= 7 * DAY_MS) : undefined;
    for (const old of verifiedOnes.slice(0, Math.max(0, verifiedOnes.length - settings.backupKeep))) {
      if (old === pinned) continue;
      deps.backups.remove(c.id, old.file); b.backups.splice(b.backups.indexOf(old), 1);
      log(c, "backup_pruned", "reconciler", "generations", { file: old.file });
    }
    deps.save(c);
    return verified;
  }

  /** a setup step still under way is waiting, not failing: polled again soon, and only a setup past 45 minutes fails */
  function wait(c: StoredCloud, ms: number) {
    if (now() - (state(c).setupSince ?? c.provisionedAt ?? c.createdAt) > 45 * MINUTE) throw new Error("Cloud setup timed out.");
    c.nextAttemptAt = now() + ms; deps.save(c);
  }

  async function provisionStep(c: StoredCloud, entitled: boolean) {
    const b = state(c);
    if (!entitled) { log(c, "provision_held", "reconciler", "not_entitled"); c.status = "stopped"; c.setupStep = null; deps.save(c); return; }
    if (c.setupStep === "reserving") {
      if (!c.workspaceId || !c.linkPublicKey || !c.sealedLinkPrivateKey) throw new Error("Missing cloud bootstrap.");
      const link = { v: 1 as const, url: deps.dashboardUrl, workspaceId: c.workspaceId, publicKey: c.linkPublicKey, privateKey: deps.unseal(c.sealedLinkPrivateKey), enrolledAt: c.provisionedAt ?? now(), claimed: true };
      const fromTemplate = settings.template !== null && b.restoreFrom === null && b.attempt === 0;
      // the machine gets a one-time claim, never its secrets: the provider's API and its logs never carry them
      let boot = boatBootFile({ cloudId: c.id, adminOrigin: deps.adminOrigin, secret: secret(c), dashboardUrl: deps.dashboardUrl, link });
      if (settings.claims) {
        // the same claim for the same attempt: a retried create gets the first machine back, with the first boot file
        const claim = createHmac("sha256", deps.backupSecret).update(`omb-managed-claim:${c.id}:${b.attempt}`).digest("base64url");
        b.claim = { hash: createHash("sha256").update(claim).digest("hex"), expiresAt: now() + HOUR, redeemedAt: null };
        boot = claimBootFile({ cloudId: c.id, claim, redeem: `${deps.dashboardUrl}/v1/managed/claims/redeem` });
      }
      const server = await provider.create({ cloudId: c.id, spec: c.spec, region: c.region, userData: boatSetupScript({ releaseKeys: deps.releaseKeys, requireSigned: settings.requireSigned }),
        ttlSeconds: settings.leaseSeconds, attempt: b.attempt, files: [boot], ...(fromTemplate ? { from: settings.template! } : {}) });
      c.serverId = server.id; b.upstream = server.origin ?? null; c.origin = null; b.installed = fromTemplate ? templatePackage : null; b.leaseAt = now(); b.setupSince = now();
      log(c, "create", "reconciler", b.attempt ? "recovery" : "paid", { attempt: b.attempt, template: fromTemplate });
      c.setupStep = "storage"; deps.save(c); return;
    }
    if (!c.serverId) throw new Error("Missing cloud server.");
    if (c.setupStep === "storage") {
      const s = await provider.sandbox(c.serverId);
      if (!s || !["ready", "idle", "running"].includes(s.state) || (s.setup !== "done" && s.setup !== null && s.setup !== "failed")) return wait(c, 5_000);
      if (s.setup === "failed") throw new Error("Cloud setup failed.");
      const pkg = settings.package;
      if (pkg && b.installed !== pkg.sha256) {
        if (pkg.file) await provider.upload(c.serverId, BOAT_PACKAGE_FILE, readFileSync(pkg.file));
        const done = await provider.run(c.serverId, installCommand(pkg.sha256, pkg.url, pkg.signature), 600);
        if (!done.ok || !done.stdout.includes("installed")) throw new RetryableCloudError("Cloud package install failed.");
        b.installed = pkg.sha256; deps.save(c);
      }
      if (b.restoreFrom) {
        const tar = deps.backups.read(c.id, keyOf(c), b.restoreFrom, legacyKeyOf(c));
        await provider.upload(c.serverId, BOAT_RESTORE_FILE, tar);
        const done = await provider.run(c.serverId, RESTORE_COMMAND, 600);
        if (!done.ok || !done.stdout.includes("restored")) throw new RetryableCloudError("Cloud restore failed.");
        const from = b.backups.find(g => g.file === b.restoreFrom);
        b.restoredFrom = { file: b.restoreFrom, at: from?.snapshotAt ?? now() }; b.restoreFrom = null;
        log(c, "restore", "reconciler", "recovery", { file: b.restoredFrom.file });
      }
      c.setupStep = "starting"; deps.save(c); return;
    }
    if (c.setupStep === "starting") {
      publish(c, state(c).upstream ?? await provider.origin(c.serverId));
      const started = await provider.run(c.serverId, startCommand(c.origin!, homeOrigin(c)), 120);
      if (!started.ok) throw new RetryableCloudError("Cloud home did not start.");
      c.setupStep = "checking"; deps.save(c); return;
    }
    if (!c.origin || !(await deps.home.healthy(homeOrigin(c), secret(c)))) return wait(c, 5_000);
    await entitle(c, true);
    if (b.claim) b.claim = null;
    c.status = "running"; c.setupStep = null; c.lastCheckedAt = now(); c.powerSince = now(); c.wantPower = "on";
    b.wakeStartedAt = null; b.lastPowerAt = now(); b.sleptAt = null; b.sleepReason = null;
    c.attempts = 0; c.nextAttemptAt = 0; c.error = null;
    log(c, "running", "reconciler", b.restoredFrom ? "recovered" : "provisioned");
    if (b.restoredFrom && b.attempt > 0) notice(c, "recovered", b.restoredFrom.file ? b.restoredFrom.at : null);
    deps.save(c);
  }

  /** a lost machine: a fresh sandbox, from the newest verified backup when there is one; the old one is retired, never deleted here */
  function recover(c: StoredCloud, why: string) {
    const b = state(c), from = latestVerified(b);
    if (c.serverId && !b.retired.some(r => r.serverId === c.serverId)) b.retired.push({ serverId: c.serverId, at: now(), deletion: null });
    b.attempt++; b.recoveries++; b.restoreFrom = from?.file ?? null; b.installed = null; b.restoredFrom = from ? null : { file: "", at: 0 };
    c.serverId = null; c.origin = null; b.upstream = null; b.claim = null; c.status = "provisioning"; c.setupStep = "reserving"; c.attempts = 0; c.nextAttemptAt = 0;
    if (!c.sealedLinkPrivateKey) { const keys = linkKeys(); c.linkPublicKey = keys.publicKey; c.sealedLinkPrivateKey = deps.seal(keys.privateKey); }
    log(c, "recover", "reconciler", why, { backup: from?.file ?? null, attempt: b.attempt });
    deps.save(c);
  }

  async function sleepNow(c: StoredCloud, reason: BoatCloudState["sleepReason"], actor: AuditActor) {
    const b = state(c);
    if (!c.serverId) return;
    await provider.power(c.serverId, "off");
    b.sleptAt = now(); b.sleepReason = reason; c.status = reason === "plan" ? "stopped" : "sleeping"; c.powerSince = now(); c.wantPower = "off";
    log(c, "sleep", actor, reason ?? "idle", { nextDueAt: b.nextDueAt });
    deps.save(c);
  }

  /** the stored record wins where it is more careful: a hold, a suspension or an owner's cancel this process has not seen */
  function rereadStored(c: StoredCloud): boolean {
    const b = state(c), fresh = deps.stored(c.id);
    if (!fresh?.managed) { log(c, "delete_refused", "reconciler", "record_unreadable"); return false; }
    if (fresh.managed.hold && !b.hold) b.hold = true;
    if (fresh.suspended !== null && c.suspended === null) c.suspended = fresh.suspended;
    const cancelled = fresh.managed.deleteRequest?.cancelledAt ?? null;
    if (cancelled !== null && b.deleteRequest && b.deleteRequest.cancelledAt === null) b.deleteRequest.cancelledAt = cancelled;
    return true;
  }

  /** the final backup, opened now with this service's key and checked to be this cloud's volume: the copy deletion relies on */
  function finalBackupOpens(c: StoredCloud): boolean {
    const final = latestVerified(state(c));
    let problem: string | null = "no_final_backup";
    if (final) {
      try { problem = homeVolumeProblem(deps.backups.read(c.id, keyOf(c), final.file, legacyKeyOf(c)), c.id); } catch { problem = "unreadable"; }
    }
    if (problem === null) return true;
    log(c, "delete_refused", "reconciler", `backup_${problem}`);
    console.warn(`boat: ALERT cloud ${c.id} is due for deletion but its final backup does not open (${problem}); nothing was deleted`);
    return false;
  }

  async function deleteStep(c: StoredCloud, verdict: Extract<Verdict, { delete: true }>) {
    const b = state(c);
    if (c.serverId && !b.deletion && (await provider.sandbox(c.serverId))?.stopStatus === "failing") { log(c, "delete_waiting", "reconciler", "stop_failing"); return; }
    if (b.deletion && b.deletion.sent === false && (await provider.sandbox(b.deletion.serverId)) !== null) {
      // a DELETE whose answer never came, and the sandbox is still there: asked again only if the verdict still says so
      if (!rereadStored(c)) return;
      const again = verdictFor(c);
      if (!again.delete) { log(c, "delete_aborted", "reconciler", again.reason); b.deletion = null; c.status = "stopped"; deps.save(c); return; }
      const answer = await provider.requestDelete(b.deletion.serverId);
      b.deletion.operationId = answer.operationId; b.deletion.sent = true; deps.save(c);
      if (!answer.gone) return;
    }
    if (!b.deletion && c.serverId) {
      // last check against the record, right before Boat is asked
      if (!rereadStored(c)) return;
      const again = verdictFor(c);
      if (!again.delete) { log(c, "delete_refused", "reconciler", again.reason); return; }
      if (again.reason === "retention_over" && !finalBackupOpens(c)) return;
      // recorded before the call, so a lost answer is never read as a lost machine (and rebuilt)
      c.status = "destroying"; b.deletion = { serverId: c.serverId, operationId: null, at: now(), reason: verdict.reason, sent: false }; deps.save(c);
      log(c, "delete_requested", "reconciler", verdict.reason);
      const answer = await provider.requestDelete(c.serverId);
      b.deletion.operationId = answer.operationId; b.deletion.sent = true;
      log(c, "delete_accepted", "reconciler", verdict.reason, { operation: answer.operationId });
      deps.save(c);
      if (!answer.gone) return;
    }
    if (b.deletion?.operationId) {
      const op = await provider.deletion(b.deletion.operationId);
      if (op && op.status !== "completed") return;
    }
    if (b.deletion && (await provider.sandbox(b.deletion.serverId)) !== null) return;
    for (const old of b.retired) if (!old.deletion) {
      const answer = await provider.requestDelete(old.serverId);
      old.deletion = { operationId: answer.operationId, at: now() };
      log(c, "delete_requested", "reconciler", "retired_with_cloud", { operation: answer.operationId });
    }
    if (c.workspaceId) deps.removeWorkspace(c.workspaceId);
    c.destroyedOrigin = c.origin ?? c.destroyedOrigin;
    c.status = "destroyed"; c.setupStep = null; c.origin = null; c.serverId = null; c.ipv4 = null;
    b.deletedAt = now();
    b.backupsDeleteAfter = verdict.reason === "owner_request" ? now() : now() + settings.backupTailMs;
    log(c, "deleted", "reconciler", verdict.reason);
    notice(c, "deleted", now());
    deps.save(c);
  }

  /** backups outlive the sandbox for a while, then go through the same record check */
  function dropBackupsWhenDue(c: StoredCloud) {
    const b = state(c);
    if (b.deletedAt === null || b.backupsDeleteAfter === null || b.backupsDeleteAfter > now() || !b.backups.length || b.hold) return;
    if (!rereadStored(c) || b.hold) return;
    if (deps.entitlement(c).active) { log(c, "delete_refused", "reconciler", "subscribed"); return; }
    for (const g of [...b.backups]) { deps.backups.remove(c.id, g.file); b.backups.splice(b.backups.indexOf(g), 1); }
    log(c, "backups_deleted", "reconciler", b.deletion?.reason ?? "retention_over");
    deps.save(c);
  }

  /** a sandbox a recovery replaced, or a second one the sweep found: stopped, its disk kept alive and backed up from its
   *  own latest state, and never deleted here. If it holds data newer than what the cloud came back from, the operator
   *  is alerted to bring it over; both copies stay. */
  async function retiredStep(c: StoredCloud) {
    const b = state(c);
    for (const old of b.retired) {
      if (old.deletion) continue;
      const s = await provider.sandbox(old.serverId);
      if (!s) continue;
      if (["ready", "idle", "running"].includes(s.state)) { await provider.power(old.serverId, "off"); log(c, "retired_stopped", "reconciler", "kept", { old: old.serverId }); continue; }
      if (s.state !== "archived") continue;
      if (!old.backedUp && (b.lastBackupTryAt ?? 0) + BACKUP_RETRY_MS <= now()) {
        if (await backup(c, "retired", old.serverId, true)) {
          old.backedUp = now();
          const restored = b.restoredFrom?.at ?? 0;
          if ((s.snapshotAt ?? 0) > restored) {
            log(c, "retired_has_newer_data", "reconciler", "operator_decides", { old: old.serverId });
            console.warn(`boat: ALERT cloud ${c.id}: replaced sandbox ${old.serverId} holds data newer than the backup the cloud came back from; both are kept`);
          }
          deps.save(c);
        }
        continue;
      }
      // its disk is still the only full copy of that state on Boat: keep Boat's 14-day clock from running out
      if (mayRefresh(c, s.stoppedAt, true)) { await provider.power(old.serverId, "on"); log(c, "refresh", "reconciler", "retired_disk_age", { old: old.serverId }); }
    }
  }

  /** a sandbox is lost only after repeated direct 404s spread over `lostAfterMs` and its absence from the account's list */
  async function confirmLost(c: StoredCloud): Promise<boolean> {
    const b = state(c);
    if (!b.missingSince) { b.missingSince = now(); b.missingChecks = 0; log(c, "missing_seen", "reconciler", "first_404"); }
    b.missingChecks = (b.missingChecks ?? 0) + 1;
    if (b.missingChecks < 3 || now() - b.missingSince < settings.lostAfterMs) {
      c.nextAttemptAt = now() + Math.max(60_000, Math.floor(settings.lostAfterMs / 3)); deps.save(c); return false;
    }
    if (c.serverId && await provider.listed(c.serverId)) { log(c, "missing_but_listed", "reconciler", "kept"); b.missingSince = now(); b.missingChecks = 0; deps.save(c); return false; }
    return true;
  }

  /** retention bookkeeping for a plan that ended: the clock, the notices */
  async function planEnded(c: StoredCloud, entitlement: Entitlement, verdict: Verdict, up: boolean) {
    const b = state(c);
    if (b.endedAt === null) {
      b.endedAt = now();
      log(c, "plan_ended", "billing", "record", { until: entitlement.until });
      if (c.origin && up) await deps.home.plan?.(homeOrigin(c), secret(c), { cancelled: true }).catch(() => {});
      deps.save(c);
    }
    if (verdict.earliestAt !== null) { const kind = dueNotice({ now: now(), earliestAt: verdict.earliestAt, sent: b.notices.map(n => n.kind as NoticeKind) }); if (kind) notice(c, kind, verdict.earliestAt); }
  }

  /** backups sealed with a key the home itself could derive are sealed again with this service's key, one per pass */
  function rekeyBackups(c: StoredCloud) {
    const b = state(c);
    for (const g of b.backups) {
      if (deps.backups.version(c.id, g.file) !== 1) continue;
      const legacy = legacyKeyOf(c);
      if (!legacy) { log(c, "backup_rekey_failed", "reconciler", "no_legacy_key", { file: g.file }); return; }
      const tar = deps.backups.read(c.id, keyOf(c), g.file, legacy);
      const record = deps.backups.write(c.id, keyOf(c), tar);
      if (homeVolumeProblem(deps.backups.read(c.id, keyOf(c), record.file), c.id) !== null) { deps.backups.remove(c.id, record.file); log(c, "backup_rekey_failed", "reconciler", "unverified", { file: g.file }); return; }
      const old = g.file;
      Object.assign(g, { file: record.file, bytes: record.bytes, sha256: record.sha256, verifiedAt: now() });
      deps.save(c);
      deps.backups.remove(c.id, old);
      log(c, "backup_rekeyed", "reconciler", "server_key", { from: old, to: record.file });
      return;
    }
  }

  /** one step; a step that ran through ends a streak of provider limits */
  async function reconcile(c: StoredCloud): Promise<void> {
    await reconcileStep(c);
    const b = state(c);
    if (b.limitStreak) { b.limitStreak = 0; deps.save(c); }
  }

  async function reconcileStep(c: StoredCloud): Promise<void> {
    const b = state(c);
    if (b.backups.length) rekeyBackups(c);
    if (c.status === "checkout") return;
    if (c.status === "destroyed") { dropBackupsWhenDue(c); return; }
    const entitlement = deps.entitlement(c);
    const verdict = verdictFor(c, entitlement);
    if (verdict.delete || b.deletion) return deleteStep(c, verdict.delete ? verdict : { delete: true, reason: (b.deletion?.reason ?? "retention_over") as "retention_over", earliestAt: now() });
    if (c.status === "provisioning") return provisionStep(c, entitlement.active);
    if (!c.serverId) {
      // an ended plan with no machine (a rebuild held for want of a plan) still gets its notices and keeps its old disks
      if (!entitlement.active) { if (c.status !== "stopped") { c.status = "stopped"; deps.save(c); } await planEnded(c, entitlement, verdict, false); await retiredStep(c); }
      return;
    }
    if (c.suspended !== null) {
      const s = await provider.sandbox(c.serverId);
      if (s && ["ready", "idle", "running", "provisioned", "cloning"].includes(s.state)) await sleepNow(c, "operator", "operator");
      c.status = "suspended"; c.suspensionApplied = true; deps.save(c); return;
    }
    const s = await provider.sandbox(c.serverId);
    if (!s || s.state === "cancelled") { if (await confirmLost(c)) return recover(c, "missing"); return; }
    if (b.missingSince) { log(c, "missing_cleared", "reconciler", "answered"); b.missingSince = null; b.missingChecks = 0; deps.save(c); }
    if (s.dataExpired) return recover(c, "data_expired");
    if (stopFailing(c, s.stopStatus === "failing")) return;
    // the snapshot a stop saved: a final backup must be at least this new
    const stopSnapshot = s.state === "archived" ? s.snapshotAt ?? s.stoppedAt : null;
    if (stopSnapshot !== null && stopSnapshot !== b.lastStopAt) { b.lastStopAt = stopSnapshot; deps.save(c); }

    if (!entitlement.active) {
      await planEnded(c, entitlement, verdict, ["ready", "idle", "running"].includes(s.state));
      if (["ready", "idle", "running"].includes(s.state)) return sleepNow(c, "plan", "billing");
      if (s.state === "archived") {
        c.status = "stopped";
        if (!latestVerified(b) || latestVerified(b)!.snapshotAt < (s.snapshotAt ?? 0)) { if ((b.lastBackupTryAt ?? 0) + BACKUP_RETRY_MS <= now()) await backup(c, "plan_ended"); }
        await retiredStep(c);
        // keep Boat's copy of the disk alive while we promise to keep it: a short resume restarts its 14-day clock
        if (verdict.earliestAt !== null && verdict.earliestAt - now() > DAY_MS && mayRefresh(c, s.stoppedAt)) {
          await provider.power(c.serverId, "on"); b.wakeStartedAt = now(); log(c, "refresh", "reconciler", "disk_age"); deps.save(c);
        }
      }
      return;
    }
    if (b.endedAt !== null) {
      b.endedAt = null; b.notices = b.notices.filter(n => !["ended", "left_30", "left_7", "left_1"].includes(n.kind));
      log(c, "plan_renewed", "billing", "record"); notice(c, "resumed", null);
      if (b.deleteRequest && b.deleteRequest.cancelledAt === null) { b.deleteRequest.cancelledAt = now(); b.deleteRequest.tokenHash = null; log(c, "delete_cancelled", "billing", "plan_renewed"); }
      if (c.status === "stopped") { c.status = "sleeping"; c.wantPower = "on"; }
      if (c.origin) await deps.home.plan?.(homeOrigin(c), secret(c), { cancelled: false }).catch(() => {});
    }

    const up = ["ready", "idle", "running"].includes(s.state);
    if (s.state === "error") { await provider.power(c.serverId, "on").catch(() => {}); b.wakeStartedAt = now(); log(c, "resume", "reconciler", "boat_error"); deps.save(c); return; }
    const resizeKey = `${c.desiredSpec.vcpu}-${c.desiredSpec.ramGb}-${c.desiredSpec.diskGb}`;
    const resizeWanted = (c.desiredSpec.vcpu !== c.spec.vcpu || c.desiredSpec.ramGb !== c.spec.ramGb || c.desiredSpec.diskGb !== c.spec.diskGb) && b.resizeBlocked !== resizeKey;
    if (s.state === "archived" && resizeWanted) {
      // a plan change: backed up from the stop first, then resumed onto the new size, then started like any wake
      const covered = b.backups.some(g => g.verifiedAt !== null && !g.keep && g.snapshotAt >= (s.snapshotAt ?? 0));
      if (!covered) { if ((b.lastBackupTryAt ?? 0) + BACKUP_RETRY_MS <= now() || (b.lastBackupTryAt ?? 0) < (s.stoppedAt ?? 0)) await backup(c, "resize"); if (!b.backups.some(g => g.verifiedAt !== null && !g.keep && g.snapshotAt >= (s.snapshotAt ?? 0))) return; }
      try { await provider.resize(c.serverId, c.desiredSpec); }
      catch (error) {
        if (error instanceof BoatError && error.status < 500) { b.resizeBlocked = resizeKey; log(c, "resize_refused", "reconciler", error.code); deps.save(c); return; }
        throw error;
      }
      log(c, "resize", b.resizeAskedAt ? "owner" : "reconciler", "plan_changed", { to: resizeKey });
      c.spec = { ...c.desiredSpec }; b.wakeStartedAt = now(); c.wantPower = "on"; b.resizeAskedAt = null; deps.save(c); return;
    }
    if (s.state === "archived") {
      const due = b.nextDueAt !== null && b.nextDueAt - settings.wakeLeadMs <= now();
      const stale = c.wantPower !== "on" && !due && mayRefresh(c, s.stoppedAt);
      if (c.wantPower === "on" || due || stale) {
        await provider.power(c.serverId, "on"); b.wakeStartedAt = now(); c.wantPower = "on";
        log(c, "wake", c.wakeRequestedAt && now() - c.wakeRequestedAt < 5 * MINUTE ? "owner" : "reconciler", due ? "routine_due" : stale ? "disk_age" : "asked");
        deps.save(c); return;
      }
      if (c.status !== "sleeping" && c.status !== "stopped") { c.status = "sleeping"; deps.save(c); }
      const last = b.backups.at(-1);
      if ((!last || now() - last.at >= settings.backupEveryMs) && (s.snapshotAt ?? 0) > (last?.snapshotAt ?? 0) && (b.lastBackupTryAt ?? 0) + BACKUP_RETRY_MS <= now()) await backup(c, "scheduled");
      await retiredStep(c);
      return;
    }
    if (!up) return;
    if (!c.origin || !b.upstream) publish(c, b.upstream ?? c.origin ?? await provider.origin(c.serverId));
    if (b.wakeStartedAt !== null || c.status !== "running") {
      // a resume onto a held machine keeps the service the pre-stop hook stopped: start it again every time
      const started = await provider.run(c.serverId, startCommand(c.origin!, homeOrigin(c)), 120);
      if (!started.ok || !(await deps.home.healthy(homeOrigin(c), secret(c)))) throw new RetryableCloudError("Cloud home not answering after a wake.");
      await entitle(c, true);
      log(c, "awake", "reconciler", "healthy", { ms: b.wakeStartedAt === null ? null : now() - b.wakeStartedAt });
      c.status = "running"; c.powerSince = now(); b.wakeStartedAt = null; b.sleptAt = null; b.sleepReason = null; b.lastPowerAt = now(); b.leaseAt = now();
      await provider.lease(c.serverId, settings.leaseSeconds);
      deps.save(c); return;
    }
    if (c.wantPower === "off") return sleepNow(c, "owner", "owner");
    // the owner asked to apply a plan change now: stopped through the same pre-stop hook, resized while stopped
    if (resizeWanted && b.resizeAskedAt) return sleepNow(c, "owner", "owner");
    if (b.leaseAt === null || now() - b.leaseAt >= Math.min(30 * MINUTE, settings.leaseSeconds * 500)) { await provider.lease(c.serverId, settings.leaseSeconds); b.leaseAt = now(); deps.save(c); }
    if (b.lastPowerAt !== null && now() - b.lastPowerAt < settings.powerReadMs) return;
    b.lastPowerAt = now();
    await entitle(c, false).catch(() => console.warn(`managed: the entitlement refresh for ${c.id} failed; it is tried again`));
    const power = deps.home.power ? await deps.home.power(homeOrigin(c), secret(c), settings.idleMinutes).catch(() => null) : null;
    if (!power) { deps.save(c); return; }
    b.busy = power.busy; b.nextDueAt = power.nextDueAt;
    const minAwake = c.powerSince + 2 * MINUTE;
    if (power.idle && now() >= minAwake && deps.home.sleep) {
      const agreed = await deps.home.sleep(homeOrigin(c), secret(c), settings.idleMinutes);
      if (agreed.ok) { b.nextDueAt = agreed.nextDueAt ?? power.nextDueAt; return sleepNow(c, "idle", "reconciler"); }
    }
    // a home that never sleeps still gets a backup, from Boat's background snapshot
    const last = b.backups.at(-1);
    if (now() - (last?.at ?? c.provisionedAt ?? c.createdAt) >= 2 * settings.backupEveryMs && (b.lastBackupTryAt ?? 0) + 6 * HOUR <= now()) await backup(c, "awake_overdue").catch(() => false);
    deps.save(c);
  }

  // owner's delete request: never acts at once; the reconciler deletes after the undo window, through the same verdict
  const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
  /** the machine's one-time claim, answered once (again within 10 minutes, for a lost answer) with what its boot file used to carry */
  function redeemClaim(cloudId: unknown, claim: unknown): Record<string, unknown> | null {
    if (typeof cloudId !== "string" || typeof claim !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(claim)) return null;
    const c = deps.clouds().find(x => x.id === cloudId && x.backend && x.status === "provisioning");
    const held = c?.managed?.claim;
    if (!c || !held || held.expiresAt < now() || (held.redeemedAt !== null && now() - held.redeemedAt > 5 * MINUTE)) return null;
    const given = Buffer.from(createHash("sha256").update(claim).digest("hex")), want = Buffer.from(held.hash);
    if (given.length !== want.length || !timingSafeEqual(given, want) || !c.workspaceId || !c.linkPublicKey || !c.sealedLinkPrivateKey) return null;
    if (held.redeemedAt === null) { held.redeemedAt = now(); log(c, "claim_redeemed", "system", "first_boot"); deps.save(c); }
    else {
      // a lost answer, or someone else holding the claim: either way the operator hears of it
      log(c, "claim_redeemed_again", "system", "operator_checks");
      console.warn(`managed: ALERT cloud ${c.id}: its machine claim was redeemed a second time`);
    }
    const link = { v: 1 as const, url: deps.dashboardUrl, workspaceId: c.workspaceId, publicKey: c.linkPublicKey, privateKey: deps.unseal(c.sealedLinkPrivateKey), enrolledAt: c.provisionedAt ?? now(), claimed: true };
    return bootContent({ cloudId: c.id, adminOrigin: deps.adminOrigin, secret: secret(c), dashboardUrl: deps.dashboardUrl, link });
  }
  return {
    redeemClaim,
    /** the edge's lookup: the machine's own hosted URL behind a public label */
    upstreamFor(value: string): string | null {
      if (!/^d[0-9a-f]{20}$/.test(value)) return null;
      const c = deps.clouds().find(x => x.backend && x.managed?.label === value && x.status !== "destroyed" && x.status !== "destroying");
      return c?.managed?.upstream ?? null;
    },
    reconcile,
    verdict: (c: StoredCloud) => verdictFor(c),
    backup: (c: StoredCloud) => backup(c, "manual"),
    requestDelete(c: StoredCloud, link: (token: string) => string) {
      const b = state(c);
      if (c.status === "destroyed" || c.status === "destroying") throw new ManagedCloudError(409, "unavailable");
      if (deps.entitlement(c).active) throw new ManagedCloudError(409, "billing_active");
      const token = randomBytes(32).toString("base64url");
      b.deleteRequest = { requestedAt: now(), tokenHash: hashToken(token), tokenExpiresAt: now() + HOUR, confirmedAt: null, executeAfter: null, cancelledAt: null };
      log(c, "delete_asked", "owner", "email_sent");
      deps.save(c);
      notice(c, "delete_requested", null, link(token));
    },
    confirmDelete(c: StoredCloud, token: string) {
      const b = state(c), request = b.deleteRequest;
      if (!request || request.cancelledAt !== null || request.confirmedAt !== null || !request.tokenHash || request.tokenExpiresAt === null || request.tokenExpiresAt < now()) throw new ManagedCloudError(409, "confirmation_required");
      const given = Buffer.from(hashToken(token)), want = Buffer.from(request.tokenHash);
      if (given.length !== want.length || !timingSafeEqual(given, want)) throw new ManagedCloudError(409, "confirmation_required");
      if (deps.entitlement(c).active) throw new ManagedCloudError(409, "billing_active");
      request.confirmedAt = now(); request.executeAfter = now() + settings.deleteDelayDays * DAY_MS; request.tokenHash = null; request.tokenExpiresAt = null;
      log(c, "delete_confirmed", "owner", "email_link", { executeAfter: request.executeAfter });
      deps.save(c);
      notice(c, "delete_scheduled", request.executeAfter);
      return request.executeAfter;
    },
    cancelDelete(c: StoredCloud) {
      const b = state(c);
      if (!b.deleteRequest || b.deleteRequest.cancelledAt !== null || b.deletion || c.status === "destroying" || c.status === "destroyed") throw new ManagedCloudError(409, "unavailable");
      b.deleteRequest.cancelledAt = now(); b.deleteRequest.tokenHash = null;
      log(c, "delete_cancelled", "owner", "undo");
      deps.save(c);
      notice(c, "delete_cancelled", null);
    },
    /** apply a pending plan change now instead of at the next idle sleep */
    resizeNow(c: StoredCloud) { state(c).resizeAskedAt = now(); c.nextAttemptAt = 0; deps.save(c); },
    resizing(c: StoredCloud) { return c.desiredSpec.vcpu !== c.spec.vcpu || c.desiredSpec.ramGb !== c.spec.ramGb || c.desiredSpec.diskGb !== c.spec.diskGb || state(c).wakeStartedAt !== null; },
    /** when a failed step runs again; null: the clouds service's own backoff */
    /** a provider limit (429) is no failure: backed off 30 s doubling to 5 minutes (or as long as it asks), never counted */
    retryAt(c: StoredCloud, error: unknown): number | null {
      const b = state(c);
      if (!(error instanceof ProviderLimitError)) { if (b.limitStreak) { b.limitStreak = 0; deps.save(c); } return null; }
      // setup keeps its 45-minute ceiling: past it a limit fails setup like any other cause
      if (c.status === "provisioning" && now() - (b.setupSince ?? c.provisionedAt ?? c.createdAt) > 45 * MINUTE) return null;
      b.limitStreak = (b.limitStreak ?? 0) + 1;
      if (b.limitStreak === 1) log(c, "provider_limit", "reconciler", "rate_limited");
      if (b.limitStreak === 12) { log(c, "provider_limit_long", "reconciler", "operator_decides"); console.warn(`managed: ALERT cloud ${c.id}: the provider has refused it 12 times in a row (rate or quota limit)`); }
      const backoff = Math.min(5 * MINUTE, 30_000 * 2 ** Math.min(b.limitStreak - 1, 4));
      deps.save(c);
      return now() + Math.max(backoff, Math.min(error.retryAfterMs ?? 0, 15 * MINUTE));
    },
    setHold(c: StoredCloud, hold: boolean) { state(c).hold = hold; log(c, hold ? "hold" : "hold_released", "operator", "manual"); deps.save(c); },
  };
}
export type BoatLifecycle = ReturnType<typeof createBoatLifecycle>;
