// this deployment's machines that no live cloud runs on: a create whose answer was lost past the provider's 24-hour
// idempotency, a cloud record lost in a restore of this service, a machine left by a deleted cloud. Each is stopped at
// once (it costs while it runs). One whose cloud was deleted through the verdict is deleted. One a live cloud owns is
// retired there only when it is older than that cloud's machine and the cloud has a verified backup newer than its last
// snapshot; otherwise it stays stopped. One no record knows is never deleted here: it may be a paying person's machine
// whose record was lost, so after the retention period the operator is alerted and decides.
import { join } from "node:path";
import { createJsonStore } from "../../dashboard/server/billing/json-store.ts";
import type { MachineProvider } from "./provider.ts";
import type { Audit } from "./audit.ts";
import { DAY_MS } from "./retention.ts";
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";

interface SweepState { v: 1; orphans: Array<{ serverId: string; cloudId: string | null; firstSeenAt: number; deletion: { operationId: string | null; at: number } | null }>; lastSweepAt: number }
const UP = new Set(["starting", "running"]);

export function createSweep(options: { dataDir: string; file: string; provider: MachineProvider; audit: Audit; retentionDays: number; now: () => number; everyMs?: number }) {
  const { provider, audit, now } = options;
  const alerted = new Set<string>();
  const store = createJsonStore<SweepState>(join(options.dataDir, options.file), () => ({ v: 1, orphans: [], lastSweepAt: 0 }),
    (v): v is SweepState => !!v && typeof v === "object" && (v as SweepState).v === 1 && Array.isArray((v as SweepState).orphans));
  const record = (cloudId: string | null, action: string, reason: string, serverId: string, detail?: Record<string, string | number | boolean | null>) =>
    audit.record({ cloudId: cloudId ?? "unknown", action, actor: "reconciler", reason, serverId, ...(detail ? { detail } : {}) });

  /** one pass; `clouds` is every cloud record, destroyed ones included */
  async function sweep(clouds: readonly StoredCloud[]): Promise<void> {
    if (now() - store.state.lastSweepAt < (options.everyMs ?? 30 * 60_000)) return;
    store.state.lastSweepAt = now(); store.commit();
    const byId = new Map(clouds.map(c => [c.id, c]));
    const known = new Set(clouds.flatMap(c => [c.serverId, ...(c.managed?.retired ?? []).map(r => r.serverId), c.managed?.deletion?.serverId, c.managed?.archive?.from].filter((id): id is string => !!id)));
    for (const s of await provider.inventory()) {
      if (known.has(s.id)) continue;
      const cloud = s.cloudId ? byId.get(s.cloudId) : undefined;
      // a create still in flight has no server id yet
      if (cloud && cloud.status === "provisioning" && cloud.setupStep === "reserving") continue;
      if (UP.has(s.state)) { await provider.power(s.id, "off"); record(s.cloudId, "orphan_stopped", cloud ? "not_its_server" : "no_record", s.id); }
      if (cloud && cloud.status !== "destroyed" && cloud.managed) {
        const current = cloud.serverId ? await provider.machine(cloud.serverId) : null;
        const newest = [...cloud.managed.backups].reverse().find(g => g.verifiedAt !== null);
        const superseded = current !== null && (s.createdAt ?? 0) < (current.createdAt ?? 0) && newest !== undefined && newest.snapshotAt > (s.stoppedAt ?? s.createdAt ?? 0);
        if (superseded) { cloud.managed.retired.push({ serverId: s.id, at: now(), deletion: null }); record(cloud.id, "orphan_retired", "superseded", s.id); }
        else if (!alerted.has(s.id)) { alerted.add(s.id); record(cloud.id, "orphan_kept", "may_hold_newer_data", s.id); console.warn(`managed: ALERT a second machine ${s.id} for cloud ${cloud.id} was stopped and kept for an operator`); }
        continue;
      }
      let orphan = store.state.orphans.find(o => o.serverId === s.id);
      if (!orphan) { orphan = { serverId: s.id, cloudId: s.cloudId, firstSeenAt: now(), deletion: null }; store.state.orphans.push(orphan); store.commit(); }
      if (orphan.deletion) continue;
      if (cloud?.status === "destroyed" && cloud.managed?.deletedAt != null) {
        const answer = await provider.requestDelete(s.id);
        orphan.deletion = { operationId: answer.operationId, at: now() }; store.commit();
        record(s.cloudId, "delete_requested", "orphan_of_deleted_cloud", s.id, { operation: answer.operationId });
      } else if (now() - orphan.firstSeenAt >= options.retentionDays * DAY_MS && !alerted.has(s.id)) {
        alerted.add(s.id);
        record(s.cloudId, "orphan_unclaimed", "operator_decides", s.id);
        console.warn(`managed: ALERT machine ${s.id} has had no cloud record for the whole retention period; it is stopped, not deleted`);
      }
    }
  }
  return { sweep, state: () => store.state, close: () => store.close() };
}
