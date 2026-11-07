import type { MausColor } from "../../../shared/wire";
import type { BotBodyId } from "../../../shared/bot-body";

/** Who pays for a number: Included in the Cloud plan, Paid from the balance, the person's Own subscription (never
 * billed by us) or the one-time Trial credit. */
export type Coverage = "included" | "paid" | "own" | "trial";
export type Category = "ai" | "computer" | "voice" | "research" | "machine";
export type TurnStatus = "ok" | "failed" | "cancelled";
export type TurnSource = "chat" | "routine" | "room" | "webhook";
export type Metric = "turns" | "spend" | "hours";

export interface Routine {
  id: string;
  botId: string;
  name: string;
  schedule: string;
  state: "on" | "paused" | "error";
  lastRunAt: number | null;
  nextRunAt: number | null;
  costPerRunUsd: number;
}

export interface Bot {
  id: string;
  name: string;
  role: string;
  color: MausColor;
  body: BotBodyId;
  engine: string;
  model: string;
  /** How this bot's AI is paid for. */
  engineCoverage: Coverage;
  computerId: string | null;
  capUsd: number | null;
  lastActiveAt: number;
  routines: Routine[];
  connectors: Array<{ name: string; access: string }>;
}

/** One finished bot turn, the unit of the heatmap and of every receipt. */
export interface Turn {
  id: string;
  at: number;
  botId: string;
  threadId: string;
  title: string;
  source: TurnSource;
  model: string;
  input: number;
  output: number;
  cached: number;
  tools: number;
  computerMinutes: number;
  voiceChars: number;
  durationMs: number;
  status: TurnStatus;
  /** Lines of the receipt; a failed turn keeps its lines at zero cost. */
  lines: Array<{ category: Category; coverage: Coverage; usd: number; estimated?: boolean }>;
}

export interface MachineSample { t: number; cpu: number; mem: number; disk: number; netMbps: number }

export interface Machine {
  name: string;
  status: "running" | "asleep" | "updating" | "unhealthy";
  region: string;
  size: { vcpu: number; ramGb: number; diskGb: number };
  host: string;
  startedAt: number;
  version: string;
  nextUpdateAt: number;
  updateWindow: string;
  samples: MachineSample[];
  snapshots: Array<{ id: string; at: number; sizeGb: number; kind: "automatic" | "manual" }>;
}

export interface BotComputer {
  id: string;
  name: string;
  state: "running" | "asleep" | "waking";
  botIds: string[];
  hoursThisMonth: number;
  lastWokeAt: number;
  idleSleepMinutes: number;
  memPct: number;
  diskFreeGb: number;
  sessions: Array<{ start: number; end: number | null; wokeBy: string }>;
  pressure?: { kind: "memory" | "disk" | "restart"; text: string };
}

export interface Allowance {
  kind: "computerHours" | "voice" | "decisions" | "x" | "research" | "storage";
  label: string;
  used: number;
  max: number;
  unit: "h" | "chars" | "calls" | "usd" | "gb" | "count";
  /** What one more unit costs past the allowance, for the tooltip. */
  overUsd: string;
}

export interface Cap { limitUsd: number; alerts: number[] }

export interface Invoice {
  id: string;
  at: number;
  number: string;
  kind: "subscription" | "top-up" | "usage";
  amountUsd: number;
  status: "paid" | "open" | "failed" | "refunded";
}

export interface PaymentMethod { id: string; brand: "visa" | "mastercard" | "amex" | "link"; last4: string; expires: string; isDefault: boolean }

export interface Billing {
  plan: { tier: "starter" | "pro" | "max"; label: string; priceUsd: number; renewsAt: number; includes: string[] };
  periodStart: number;
  periodEnd: number;
  balanceUsd: number;
  autoTopUp: { enabled: boolean; belowUsd: number; amountUsd: number };
  caps: { ai: Cap; cloud: Cap };
  grants: Array<{ id: string; label: string; remainingUsd: number; expiresAt: number }>;
  methods: PaymentMethod[];
  details: { name: string; line1: string; city: string; country: string; taxId: string; email: string };
  invoices: Invoice[];
}

export interface Session { id: string; device: string; kind: "desktop" | "phone" | "browser"; place: string; lastActiveAt: number; current?: boolean }
export interface ApiToken { id: string; name: string; scope: string; createdAt: number; lastUsedAt: number | null; prefix: string }
export interface ConnectedApp { id: string; name: string; access: string; bots: string[]; lastUsedAt: number | null }
export interface AiAccount {
  id: string;
  name: string;
  plan: string;
  ok: boolean;
  windows: Array<{ label: string; usedPercent: number; resetsAt: number | null }>;
}
export interface VaultItem { id: string; name: string; kind: string; bots: string[]; updatedAt: number }

export interface Account {
  name: string;
  initials: string;
  email: string;
  handle: string;
  timezone: string;
  language: string;
  weekStart: "sunday" | "monday";
  passkeys: Array<{ id: string; name: string; addedAt: number }>;
  twoFactor: boolean;
  sessions: Session[];
  paired: Array<{ id: string; name: string; kind: string; lastSeenAt: number }>;
  tokens: ApiToken[];
  apps: ConnectedApp[];
  aiAccounts: AiAccount[];
  vault: VaultItem[];
  notifications: Record<string, { email: boolean; push: boolean }>;
}

export interface TimelineItem {
  id: string;
  at: number;
  kind: "turn" | "routine-next" | "approval" | "computer";
  botId: string;
  text: string;
  usd?: number;
  coverage?: Coverage;
  status?: TurnStatus;
}

export interface Alert { id: string; tone: "info" | "warn" | "bad"; text: string; action: { label: string; to: string } }

/** What one part of the dashboard was drawn from, shown so a sample is never mistaken for a bill. */
export type DataOrigin = "sample" | "live";

export interface DashboardData {
  now: number;
  origin: Record<"usage" | "bots" | "billing" | "cloud" | "account", DataOrigin>;
  account: Account;
  bots: Bot[];
  turns: Turn[];
  machine: Machine;
  computers: BotComputer[];
  allowances: Allowance[];
  billing: Billing;
  alerts: Alert[];
}
