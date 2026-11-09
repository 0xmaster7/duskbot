// A managed cloud's own record, kept on the cloud as `StoredCloud.managed` (the dashboard stores it opaquely).
import type {} from "../../dashboard/server/clouds/types.ts";

/** one managed home's lifecycle record (lifecycle.ts) */
export interface BoatCloudState {
  /** bumped for each deliberate new sandbox (a recovery); part of Boat's idempotency key */
  attempt: number;
  installed: string | null;
  /** a backup generation to restore into the next fresh sandbox */
  restoreFrom: string | null;
  /** the generation the running sandbox came back from, for the notice */
  restoredFrom?: { file: string; at: number } | null;
  sleptAt: number | null;
  sleepReason: "idle" | "plan" | "owner" | "operator" | null;
  nextDueAt: number | null;
  lastPowerAt: number | null;
  busy: string[];
  leaseAt: number | null;
  lastStopAt: number | null;
  wakeStartedAt: number | null;
  /** `keep`: from a replaced sandbox's own disk, never pruned; `source`: that sandbox */
  backups: Array<{ file: string; at: number; bytes: number; sha256: string; verifiedAt: number | null; snapshotAt: number; keep?: boolean; source?: string }>;
  lastBackupTryAt: number | null;
  backupProblem: string | null;
  /** the billing record's end of the plan, as first seen: the retention clock */
  endedAt: number | null;
  notices: Array<{ kind: string; at: number }>;
  deleteRequest: { requestedAt: number; tokenHash: string | null; tokenExpiresAt: number | null; confirmedAt: number | null; executeAfter: number | null; cancelledAt: number | null } | null;
  /** Boat's receipt for an accepted delete: never sent twice */
  deletion: { serverId: string; operationId: string | null; at: number; reason: string; sent?: boolean } | null;
  deletedAt: number | null;
  backupsDeleteAfter: number | null;
  /** sandboxes this cloud had before a recovery, stopped, deleted once the new one has its own verified backup */
  retired: Array<{ serverId: string; at: number; deletion: { operationId: string | null; at: number } | null; backedUp?: number }>;
  recoveries: number;
  hold: boolean;
  /** when the current sandbox's setup began */
  setupSince?: number;
  /** Boat answered 404 for the current sandbox since this time, this many times; reset by any answer */
  missingSince?: number | null;
  missingChecks?: number;
  /** the owner asked to apply a plan change now (resize-now) */
  resizeAskedAt?: number | null;
  /** the machine's one-time claim for its secrets (only its hash), cleared once it runs */
  claim?: { hash: string; expiresAt: number; redeemedAt: number | null } | null;
  /** the opaque public label of its user-facing origin, and the machine's own hosted URL behind it */
  label?: string | null;
  upstream?: string | null;
  /** a size Boat refused (shrinking below the data, say), not tried again */
  resizeBlocked?: string | null;
}

declare module "../../dashboard/server/clouds/types.ts" {
  interface ManagedCloudState extends BoatCloudState {}
}
