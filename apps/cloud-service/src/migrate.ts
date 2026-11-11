// An operator's move of one managed home to another host (docs/hosts.md, "Cloud-to-cloud migration"): the home is
// quiesced through the normal sleep handshake (never mid-task), backed up and verified, restored into a new machine on the
// target host through the normal provisioning path, checked file by file before its home starts, and cut over by the
// record. The machine it left stays asleep for a rollback until the operator finishes the move. One step per reconcile,
// each safe to repeat; nothing is deleted except by `finish`.
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { RetryableCloudError } from "../../dashboard/server/clouds/http.ts";
import { ManagedCloudError } from "../../dashboard/server/clouds/managed.ts";
import type { HomeClient, StoredCloud } from "../../dashboard/server/clouds/types.ts";
import type { Audit } from "./audit.ts";
import type { BackupStore } from "./backups.ts";
import { checkLines, volumeManifest } from "./bundle.ts";
import type { Lifecycle } from "./lifecycle.ts";
import { ProviderError, type MachineImage, type MachineProvider } from "./provider.ts";
import type { Entitlement } from "./retention.ts";
import type { HostName, MigrationState } from "./state.ts";

const MINUTE = 60_000;
/** a copy still not running after this long is given up on, and the home goes back where it was */
const COPY_LIMIT_MS = 50 * MINUTE;

export interface MigrationHost { name: HostName; provider: MachineProvider; image: MachineImage; lifecycle: Lifecycle; keep?: readonly string[] }
export interface MigrationDeps {
  hosts: ReadonlyMap<HostName, MigrationHost>;
  backups: BackupStore;
  backupKey(cloud: StoredCloud): Buffer;
  home: HomeClient;
  audit: Audit;
  entitlement(cloud: StoredCloud): Entitlement;
  now(): number;
  save(cloud: StoredCloud): void;
}

export const hostOf = (c: StoredCloud): HostName => c.managed?.host ?? "boat";
const ACTIVE = new Set(["quiescing", "copying", "rolling_back"]);

export function createMigrations(deps: MigrationDeps) {
  const { now } = deps;
  const host = (name: HostName) => { const h = deps.hosts.get(name); if (!h) throw new ManagedCloudError(409, "host_unavailable"); return h; };
  const log = (c: StoredCloud, action: string, reason: string, detail?: Record<string, string | number | boolean | null>) =>
    deps.audit.record({ cloudId: c.id, action, actor: "operator", reason, serverId: c.serverId, ...(detail ? { detail } : {}) });
  const touch = (c: StoredCloud, m: MigrationState) => { m.updatedAt = now(); deps.save(c); };
  const waitFor = (c: StoredCloud, m: MigrationState, busy: string[], ms = MINUTE) => { m.waitingFor = busy; c.nextAttemptAt = now() + ms; touch(c, m); return true; };
  /** a generation names no machine while it is the current one's: before the record changes machine, it names it */
  const tagSources = (c: StoredCloud, serverId: string) => { for (const g of c.managed!.backups) g.source ??= serverId; };

  function start(c: StoredCloud, to: HostName): MigrationState {
    const b = c.managed;
    if (!c.backend || !b) throw new ManagedCloudError(409, "not_managed");
    if (!deps.hosts.has(to)) throw new ManagedCloudError(409, "host_unavailable");
    if (hostOf(c) === to) throw new ManagedCloudError(409, "already_there");
    if (b.migration && b.migration.phase !== "finished") throw new ManagedCloudError(409, "migration_open");
    if (!deps.entitlement(c).active || c.suspended !== null || b.deletion || b.hold || (b.deleteRequest?.confirmedAt && !b.deleteRequest.cancelledAt)) throw new ManagedCloudError(409, "unavailable");
    if (!["running", "sleeping"].includes(c.status) || !c.serverId) throw new ManagedCloudError(409, "not_settled");
    // a replaced machine of the old host would be driven by the new one's adapter: those are finished first
    if (b.retired.some(r => !r.deletion)) throw new ManagedCloudError(409, "retired_machines_open");
    const m: MigrationState = { id: randomBytes(6).toString("hex"), to, phase: "quiescing", startedAt: now(), updatedAt: now(), backup: null, checked: null, waitingFor: null, error: null,
      from: { host: hostOf(c), serverId: c.serverId, upstream: b.upstream ?? null, origin: c.origin, installed: b.installed } };
    b.migration = m; c.nextAttemptAt = 0;
    log(c, "migration_started", "operator", { to, from: m.from.host });
    deps.save(c);
    return m;
  }

  /** quiet, backed up and verified on the source; then the record moves to the target and provisioning takes over */
  async function quiesce(c: StoredCloud, m: MigrationState): Promise<boolean> {
    const src = host(m.from.host), b = c.managed!, serverId = c.serverId!;
    const s = await src.provider.machine(serverId);
    if (!s) { m.error = "source_missing"; m.phase = "finished"; log(c, "migration_aborted", "source_missing"); touch(c, m); return false; }
    if (!["running", "stopped"].includes(s.state)) return waitFor(c, m, [`machine:${s.state}`], 15_000);
    const live = src.provider.capabilities?.liveBackup === true;
    if (s.state === "running") {
      const { origin, secret } = src.lifecycle.homeAccess(c);
      const power = deps.home.power ? await deps.home.power(origin, secret, 1).catch(() => null) : null;
      if (!power || !power.idle) return waitFor(c, m, power?.busy ?? ["unreachable"]);
      const agreed = deps.home.sleep ? await deps.home.sleep(origin, secret, 1).catch(() => ({ ok: false as const, busy: ["unreachable"] })) : { ok: true as const };
      if (!agreed.ok) return waitFor(c, m, "busy" in agreed && Array.isArray(agreed.busy) ? agreed.busy : ["busy"]);
      if (live) {
        if (!(await src.lifecycle.backupFor(c, "migration"))) { m.error = b.backupProblem ?? "backup_unverified"; return waitFor(c, m, ["backup"], 5 * MINUTE); }
        m.backup = b.backups.at(-1)!.file;
      }
      await src.provider.power(serverId, "off");
      c.status = "sleeping"; c.wantPower = "off"; b.sleptAt = now(); b.sleepReason = "operator";
      log(c, "migration_quiesced", live ? "live_backup" : "stopped");
      return waitFor(c, m, [], live ? 0 : 15_000);
    }
    if (!m.backup) {
      // a machine that was asleep when the move began: a stop's snapshot where the host keeps one, else woken for a live one
      if (live) { await src.provider.power(serverId, "on"); return waitFor(c, m, ["waking"], 15_000); }
      if (!(await src.lifecycle.backupFor(c, "migration"))) { m.error = b.backupProblem ?? "backup_unverified"; return waitFor(c, m, ["backup"], MINUTE); }
      m.backup = b.backups.at(-1)!.file;
    }
    // the record moves: the old machine is kept in the migration, never in `retired`, so no adapter but its own touches it
    tagSources(c, serverId);
    b.host = m.to;
    c.serverId = null; c.origin = null; b.upstream = null; b.claim = null; b.installed = null;
    b.restoreFrom = m.backup; b.restoredFrom = null; b.attempt++;
    c.status = "provisioning"; c.setupStep = "reserving"; c.wantPower = "on"; c.attempts = 0; c.nextAttemptAt = 0; c.error = null;
    m.phase = "copying"; m.waitingFor = null; m.error = null;
    log(c, "migration_copying", "verified_backup", { backup: m.backup, to: m.to });
    touch(c, m);
    return true;
  }

  /** the new machine's volume against the backup it came from, before its home starts; a mismatch rolls the move back */
  async function afterRestore(c: StoredCloud, serverId: string, file: string): Promise<void> {
    const m = c.managed?.migration;
    if (!m || m.phase !== "copying" || file !== m.backup) return;
    const target = host(m.to);
    const manifest = volumeManifest(deps.backups.read(c.id, deps.backupKey(c), file), c.id, { kind: "managed", host: m.from.host });
    const lines = checkLines(manifest, { keep: target.keep ?? [] });
    const path = `${dirname(target.image.restorePath)}/omb-migration.sha256`;
    await target.provider.upload(serverId, path, Buffer.from(lines.text));
    const result = await target.provider.run(serverId, `out="$(cd / && sudo -n sha256sum -c --quiet ${path} 2>&1)"; n="$(printf '%s' "$out" | grep -c FAILED || true)"; printf '%s\\n' "$out" | grep FAILED | head -n 20; rm -f ${path}; echo "mismatched $n"`, 600);
    const mismatched = Number(/mismatched (\d+)/.exec(result.stdout)?.[1] ?? Number.NaN);
    m.checked = { files: lines.checked, mismatched: Number.isFinite(mismatched) ? mismatched : -1, skipped: lines.skipped, at: now() };
    if (mismatched === 0) { log(c, "migration_checked", "files_match", { files: lines.checked, browser: manifest.layers.browser?.files ?? 0 }); touch(c, m); return; }
    m.error = Number.isFinite(mismatched) ? `files_differ:${mismatched}` : "check_failed";
    m.phase = "rolling_back";
    log(c, "migration_check_failed", m.error, { files: lines.checked });
    touch(c, m);
    throw new RetryableCloudError("The migrated volume did not match its backup; rolling back.");
  }

  /** back to the machine the home left: the new one is put to sleep (its state backed up first if it ran) and kept */
  async function rollBack(c: StoredCloud, m: MigrationState): Promise<boolean> {
    const b = c.managed!;
    if (c.serverId && hostOf(c) !== m.from.host) {
      const target = host(hostOf(c)), id = c.serverId, s = await target.provider.machine(id);
      const live = target.provider.capabilities?.liveBackup === true;
      if (s && !["running", "stopped"].includes(s.state)) return waitFor(c, m, [`machine:${s.state}`], 15_000);
      // what the home did on the new machine since the cut-over is backed up and kept, never silently dropped
      if (s && m.ranOnTarget && !m.targetBackup) {
        if (s.state === "running") {
          const { origin, secret } = target.lifecycle.homeAccess(c);
          const power = deps.home.power ? await deps.home.power(origin, secret, 1).catch(() => null) : null;
          if (power && !power.idle) return waitFor(c, m, power.busy);
          if (!live) { await target.provider.power(id, "off"); return waitFor(c, m, ["stopping"], 15_000); }
        } else if (live) { await target.provider.power(id, "on"); return waitFor(c, m, ["waking"], 15_000); }
        if (!(await target.lifecycle.backupFor(c, "rollback", id, true))) return waitFor(c, m, ["backup"], MINUTE);
        m.targetBackup = b.backups.at(-1)!.file;
        log(c, "migration_target_kept", "newer_state_backed_up", { target: id, backup: m.targetBackup });
      }
      if (s?.state === "running") { await target.provider.power(id, "off"); return waitFor(c, m, ["stopping"], 15_000); }
      m.target = { host: hostOf(c), serverId: id };
    }
    if (c.serverId) tagSources(c, c.serverId);
    if (m.from.host === "boat") delete b.host; else b.host = m.from.host;
    c.serverId = m.from.serverId; c.origin = m.from.origin; b.upstream = m.from.upstream; b.installed = m.from.installed;
    b.restoreFrom = null; b.restoredFrom = null; b.claim = null; b.wakeStartedAt = null;
    c.status = "sleeping"; c.setupStep = null; c.wantPower = "on"; c.wakeRequestedAt = now(); c.attempts = 0; c.nextAttemptAt = 0; c.error = null;
    m.phase = "rolled_back"; m.waitingFor = null;
    log(c, "migration_rolled_back", m.error ?? "operator", { target: m.target?.serverId ?? null });
    touch(c, m);
    return false;
  }

  return {
    start,
    afterRestore,
    active: (c: StoredCloud) => !!c.managed?.migration && ACTIVE.has(c.managed.migration.phase),
    /** a migration's own step; true when it took this pass (the host's lifecycle waits) */
    async step(c: StoredCloud): Promise<boolean> {
      const m = c.managed?.migration;
      if (!m) return false;
      if (m.phase === "quiescing") return quiesce(c, m);
      if (m.phase === "rolling_back") return rollBack(c, m);
      if (m.phase === "copying" && now() - m.updatedAt > COPY_LIMIT_MS && c.status !== "running") { m.error = "copy_timed_out"; m.phase = "rolling_back"; touch(c, m); return rollBack(c, m); }
      return false;
    },
    /** the target provider refused the copy outright (its account cannot create, the size is not offered): rolled back
     *  at once instead of after the copy's time limit; true when it took the error */
    refused(c: StoredCloud, error: unknown): boolean {
      const m = c.managed?.migration;
      if (!m || m.phase !== "copying" || !(error instanceof ProviderError) || error.status < 400 || error.status >= 500 || [408, 409, 429].includes(error.status)) return false;
      m.error = `target_refused:${error.code}`; m.phase = "rolling_back";
      log(c, "migration_target_refused", error.code, { to: m.to });
      touch(c, m);
      return true;
    },
    /** after the host's own step: a copy whose home answers is the cut-over */
    settled(c: StoredCloud) {
      const m = c.managed?.migration;
      if (!m || m.phase !== "copying" || c.status !== "running") return;
      m.phase = "done";
      log(c, "migration_done", "home_answers", { to: m.to, files: m.checked?.files ?? null });
      touch(c, m);
    },
    /** the operator's undo, any time before `finish` */
    rollback(c: StoredCloud) {
      const m = c.managed?.migration;
      if (!m || !["quiescing", "copying", "done"].includes(m.phase)) throw new ManagedCloudError(409, "nothing_to_roll_back");
      if (m.phase === "quiescing") { m.phase = "finished"; m.error = "cancelled"; log(c, "migration_cancelled", "operator"); c.nextAttemptAt = 0; touch(c, m); return; }
      m.ranOnTarget = m.phase === "done"; m.phase = "rolling_back"; m.error = null; c.nextAttemptAt = 0;
      log(c, "migration_rollback_asked", "operator");
      touch(c, m);
    },
    /** the operator's end of a move: the machine the home no longer runs on is deleted, through its own host. Irreversible. */
    async finish(c: StoredCloud) {
      const m = c.managed?.migration;
      if (!m || !["done", "rolled_back"].includes(m.phase)) throw new ManagedCloudError(409, "not_finishable");
      const left = m.phase === "done" ? { host: m.from.host, serverId: m.from.serverId } : m.target ?? null;
      if (left && left.serverId !== c.serverId) {
        const answer = await host(left.host).provider.requestDelete(left.serverId);
        m.deleted = { ...left, operationId: answer.operationId, at: now() };
        log(c, "migration_left_deleted", m.phase, { host: left.host, machine: left.serverId, operation: answer.operationId });
      }
      m.phase = "finished";
      touch(c, m);
    },
  };
}
export type Migrations = ReturnType<typeof createMigrations>;
