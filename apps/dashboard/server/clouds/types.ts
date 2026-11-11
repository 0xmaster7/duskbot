import type { CloudDesktopView, CloudStatus, CloudSwatch, DesktopKind, MachineSpec, Placement, PowerAction, SetupStep } from "../../../../shared/billing-api.ts";

/** a machine as the provider reports it */
export interface ProviderServer {
  id: string;
  /** the provider's own state, mapped */
  state: "creating" | "starting" | "running" | "stopping" | "off" | "deleting" | "missing" | "error";
  ipv4: string | null;
  serverType: string;
  diskGb: number;
  origin?: string;
}

export interface CreateServerInput {
  /** our cloud id, also the server's name and label, so a retried create finds the first one */
  cloudId: string;
  spec: MachineSpec;
  region: string;
  userData: string;
  quota?: SlotQuota;
}

/** provisioning backend. dedicated: fake or hetzner. pool: PoolProvider over pool hosts (fake driver in tests). */
export interface CloudProvider {
  readonly name: "fake" | "hetzner" | "pool" | "managed";
  /** the server a create made for this cloud id, if any (idempotent create) */
  find(cloudId: string): Promise<ProviderServer | null>;
  create(input: CreateServerInput): Promise<ProviderServer>;
  status(serverId: string): Promise<ProviderServer>;
  power(serverId: string, action: PowerAction): Promise<void>;
  /** stops a suspended machine without relying on guest cooperation */
  suspend?(serverId: string, reason: string): Promise<void>;
  /** dedicated servers must be off; pool quotas can change live */
  resize(serverId: string, spec: MachineSpec, quota?: SlotQuota): Promise<void>;
  destroy(serverId: string): Promise<void>;
  /** removes unattached storage left by an interrupted create */
  cleanup?(cloudId: string): Promise<void>;
}

/** a big shared host in the pool, as its driver reports it */
export interface PoolHost {
  id: string;
  region: string;
  /** physical resources available for slots, before the provider's overcommit */
  capacity: { vcpu: number; ramGb: number; diskGb: number; slots: number };
  /** https origins of slots on it are https://<cloudId>.<domain> */
  domain: string;
  draining: boolean;
}
/** the hard limits a slot (one user's server container plus its bot computer containers) runs under */
export interface SlotQuota { vcpu: number; ramGb: number; diskGb: number; netMbps: number; pids: number; botComputers: number | null }
export interface SlotState { id: string; hostId: string; cloudId?: string; state: ProviderServer["state"] | "suspended"; quota: SlotQuota }

/** one host agent per pool host (gVisor containers, separate networks, no shared disks or secrets); fake in tests */
export interface PoolHostDriver {
  hosts(): Promise<PoolHost[]>;
  slots(hostId: string): Promise<SlotState[]>;
  createSlot(hostId: string, input: { cloudId: string; quota: SlotQuota; bootstrap: string }): Promise<SlotState>;
  slot(hostId: string, slotId: string): Promise<SlotState | null>;
  findSlot(cloudId: string): Promise<SlotState | null>;
  power(hostId: string, slotId: string, action: PowerAction): Promise<void>;
  setQuota(hostId: string, slotId: string, quota: SlotQuota): Promise<void>;
  suspend(hostId: string, slotId: string, reason: string): Promise<void>;
  resume(hostId: string, slotId: string): Promise<void>;
  destroySlot(hostId: string, slotId: string): Promise<void>;
}

/** the admin's signed requests to a cloud desktop's own Dusk Bot (server/cloud-home.ts) */
export interface HomeClient {
  pair(origin: string, secret: string, input: { label: string; ttlSeconds?: number }): Promise<{ code: string; expiresAt: number }>;
  /** true once the install answers its signed health read */
  healthy(origin: string, secret: string): Promise<boolean>;
  /** the home's idle read (server/cloud-power.ts); only managed homes are asked */
  power?(origin: string, secret: string, idleMinutes: number): Promise<HomePower>;
  /** the sleep handshake: ok once the home agreed and closed for the stop. `force`: the owner's pause, so the home tells its
   * open apps it is going to sleep even while busy, and always agrees. */
  sleep?(origin: string, secret: string, idleMinutes: number, options?: { force?: boolean }): Promise<{ ok: boolean; nextDueAt: number | null }>;
  /** a hosted home's signed entitlement (shared/entitlement.ts): it refuses clients without a valid one */
  entitle?(origin: string, secret: string, token: string): Promise<{ expiresAt: number }>;
  /** tells the home its plan was cancelled or renewed, so it holds its routines (docs/cloud-pro.md) */
  plan?(origin: string, secret: string, input: { cancelled: boolean }): Promise<void>;
  /** the home's own report after an update (server/update-state.ts): the version it runs, its self-test, its finished runs */
  update?(origin: string, secret: string): Promise<HomeUpdateReport>;
}
export interface HomeUpdateReport { version: string | null; selfTest: "running" | "passed" | "failed" | null; runs: Array<{ id: string; ok: boolean; at: number }> }
export interface HomePower {
  idle: boolean; busy: string[]; lastActivityAt: number | null; nextDueAt: number | null; wokeAt: number | null;
  /** the runs due in the next day, when the home reports them; `flexMs` is how far a run may move (0: its exact time) */
  upcoming?: Array<{ at: number; flexMs: number }>;
}

export interface StoredCloud {
  id: string;
  accountId: string;
  name: string;
  color: CloudSwatch | null;
  kind: Exclude<DesktopKind, "none">;
  placement: Placement;
  subscriptionId: string | null;
  spec: MachineSpec;
  /** the spec the plan pays for; differs from spec while a resize waits */
  desiredSpec: MachineSpec;
  region: string;
  botComputers: number | null;
  status: CloudStatus;
  setupStep: SetupStep | null;
  /** the power state the owner asked for */
  wantPower: PowerAction;
  serverId: string | null;
  ipv4: string | null;
  origin: string | null;
  destroyedOrigin?: string;
  /** aes-256-gcm sealed when a key is configured; the signing key for its Dusk Bot */
  bootstrapSecret: string;
  workspaceId: string | null;
  primary: boolean;
  hidden: boolean;
  paymentProblem: boolean;
  ended?: boolean;
  /** when `ended` was set: the retention clock of a managed cloud starts here */
  endedAt?: number;
  /** dropped from a plan that is paid to this time: runs until then, then ends */
  endsAt?: number;
  /** suspended for abuse: stays stopped until an operator resumes it */
  suspended: string | null;
  /** set while the plan is cancelled or ended; the server is destroyed after it */
  destroyAt: number | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  powerSince: number;
  linkPublicKey?: string;
  sealedLinkPrivateKey?: string;
  provisionedAt?: number;
  poolFullSince?: number;
  lastCheckedAt?: number;
  resizeStage?: "off" | "resize" | "on";
  appliedQuota?: SlotQuota;
  suspensionApplied?: boolean;
  /** the owner or the slack edge asked a stopped or sleeping desktop to wake; the edge times it to the desktop's next sync */
  wakeRequestedAt?: number;
  /** set at activation when a managed backend runs this cloud: its lifecycle is the backend's, never the generic one */
  backend?: "managed";
  /** when the owner was emailed that the cloud is ready, and that it was deleted */
  mailed?: { ready?: number; deleted?: number };
  managed?: ManagedCloudState;
  /** when this service last pushed a signed entitlement to the cloud's home */
  entitledAt?: number;
}

/** a managed backend's own per-cloud record (apps/cloud-service adds its fields to this interface) */
export interface ManagedCloudState {}

export interface DesktopPlan { kind: Exclude<DesktopKind, "none">; placement: Placement; spec: MachineSpec; botComputers: number | null }
export interface OrderInput extends DesktopPlan {
  id?: string;
  accountId: string;
  name: string;
  color: CloudSwatch | null;
  region: string;
}

/** what billing asks of cloud desktops, and what routes read */
export interface CloudsService {
  /** a desktop waiting for its checkout (status checkout) */
  order(input: OrderInput): StoredCloud;
  /** paid: provisioning starts (idempotent) */
  activate(cloudId: string, subscriptionId: string, plan: DesktopPlan): void;
  /** a plan change: resized on the next reconcile; placement changes are refused */
  changePlan(cloudId: string, plan: DesktopPlan): void;
  setPaymentProblem(cloudId: string, problem: boolean): void;
  /** destroyed at `at` unless cancelled (keep plan, renewed) */
  scheduleDestroy(cloudId: string, at: number): void;
  cancelDestroy(cloudId: string): void;
  /** the plan ended: stopped at `from` (now when it is not later), destroyed at `destroyAt` */
  end(cloudId: string, destroyAt: number, from?: number): void;
  /** a checkout that never completed */
  abandon(cloudId: string): void;
  scrubAccount(accountId: string, anonId: string): void;
  get(cloudId: string): StoredCloud | null;
  owned(accountId: string, cloudId: string): StoredCloud | null;
  /** the desktop a signed workspace belongs to */
  byWorkspace(workspaceId: string): StoredCloud | null;
  list(accountId: string, includeHidden?: boolean): StoredCloud[];
  /** every cloud of every account, for the operator */
  all?(): StoredCloud[];
  view(cloud: StoredCloud): CloudDesktopView;
  rename(accountId: string, cloudId: string, patch: { name?: string; color?: CloudSwatch | null }): StoredCloud;
  /** operator action against abuse (pool and dedicated alike) */
  suspend(cloudId: string, reason: string): Promise<void>;
  resume(cloudId: string): Promise<void>;
  hide(accountId: string, cloudId: string): StoredCloud;
  power(accountId: string, cloudId: string, action: PowerAction): Promise<StoredCloud>;
  pair(accountId: string, cloudId: string): Promise<{ origin: string; code: string; expiresAt: number }>;
  /** one pass over every desktop that needs work; safe to run concurrently with itself (serialized inside) */
  reconcile(): Promise<void>;
  /** the managed backend when one is configured: owner delete requests, operator holds, resizes */
  readonly managed?: import("./managed.ts").ManagedCloud | null;
  /** a fresh signed entitlement for the cloud's home and the app, or null when this service signs none */
  entitlement?(cloud: StoredCloud): string | null;
  close(): void;
}
