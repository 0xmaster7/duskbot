// This deployment's Boat sandboxes that no live cloud runs on: a create whose answer was lost past Boat's 24-hour
// idempotency, a cloud record lost in a restore of this service, a sandbox left by a deleted cloud. Each is stopped at
// once (it costs while it runs); one a live cloud owns goes to that cloud's retired list (deleted there, after its own
// checks); one whose cloud was deleted through the verdict is deleted; one no record knows is deleted only after it has
// been seen orphaned for the whole retention period, with an alert, since it may hold someone's data.
import { join } from "node:path";
import { createJsonStore } from "../billing/json-store.ts";
import type { BoatProvider } from "./boat.ts";
import type { Audit } from "./boat-audit.ts";
import { DAY_MS } from "./boat-retention.ts";
import type { StoredCloud } from "./types.ts";

interface SweepState { v: 1; orphans: Array<{ serverId: string; cloudId: string | null; firstSeenAt: number; deletion: { operationId: string | null; at: number } | null }>; lastSweepAt: number }
const UP = new Set(["provisioned", "cloning", "ready", "idle", "running"]);

export function createBoatSweep(options: { dataDir: string; provider: BoatProvider; audit: Audit; retentionDays: number; now: () => number; everyMs?: number }) {
  const { provider, audit, now } = options;
  const store = createJsonStore<SweepState>(join(options.dataDir, "boat-sweep.json"), () => ({ v: 1, orphans: [], lastSweepAt: 0 }),
    (v): v is SweepState => !!v && typeof v === "object" && (v as SweepState).v === 1 && Array.isArray((v as SweepState).orphans));
  const record = (cloudId: string | null, action: string, reason: string, serverId: string, detail?: Record<string, string | number | boolean | null>) =>
    audit.record({ cloudId: cloudId ?? "unknown", action, actor: "reconciler", reason, serverId, ...(detail ? { detail } : {}) });

  /** one pass; `clouds` is every cloud record, destroyed ones included */
  async function sweep(clouds: readonly StoredCloud[]): Promise<void> {
    if (now() - store.state.lastSweepAt < (options.everyMs ?? 30 * 60_000)) return;
    store.state.lastSweepAt = now(); store.commit();
    const byId = new Map(clouds.map(c => [c.id, c]));
    const known = new Set(clouds.flatMap(c => [c.serverId, ...(c.boat?.retired ?? []).map(r => r.serverId), c.boat?.deletion?.serverId].filter((id): id is string => !!id)));
    for (const s of await provider.inventory()) {
      if (known.has(s.id)) continue;
      const cloud = s.cloudId ? byId.get(s.cloudId) : undefined;
      // a create still in flight has no server id yet
      if (cloud && cloud.status === "provisioning" && cloud.setupStep === "reserving") continue;
      if (UP.has(s.state)) { await provider.power(s.id, "off"); record(s.cloudId, "orphan_stopped", cloud ? "not_its_server" : "no_record", s.id); }
      if (cloud && cloud.status !== "destroyed" && cloud.boat) {
        cloud.boat.retired.push({ serverId: s.id, at: now(), deletion: null });
        record(cloud.id, "orphan_retired", "duplicate", s.id);
        continue;
      }
      let orphan = store.state.orphans.find(o => o.serverId === s.id);
      if (!orphan) { orphan = { serverId: s.id, cloudId: s.cloudId, firstSeenAt: now(), deletion: null }; store.state.orphans.push(orphan); store.commit(); }
      if (orphan.deletion) continue;
      // a cloud deleted through the verdict leaves nothing behind; an unknown one waits out the whole retention
      const due = cloud?.status === "destroyed" && cloud.boat?.deletedAt != null ? true : now() - orphan.firstSeenAt >= options.retentionDays * DAY_MS;
      if (!due) continue;
      const answer = await provider.requestDelete(s.id);
      orphan.deletion = { operationId: answer.operationId, at: now() }; store.commit();
      record(s.cloudId, "delete_requested", cloud ? "orphan_of_deleted_cloud" : "orphan_past_retention", s.id, { operation: answer.operationId });
    }
  }
  return { sweep, state: () => store.state, close: () => store.close() };
}
