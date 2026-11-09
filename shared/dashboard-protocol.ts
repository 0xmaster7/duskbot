// the account dashboard protocol, version 1: what a workspace reports to the hosted dashboard service and the
// commands it takes back. transport-agnostic (plain https today, any relay that forwards it later), owner-only,
// never message contents or secrets. docs: apps/dashboard/README.md

export const DASHBOARD_PROTOCOL = 1;

// the default hosted instance, overridable by workspace configuration.
export const DEFAULT_DASHBOARD_URL = "https://dashboard.apps.siddz.com";

/** where a relay or a dashboard service says which dashboard it belongs to: `{ v: 1, url }` */
export const DASHBOARD_DISCOVERY_PATH = "/.well-known/openmausbot/dashboard";

/** reports come every 5 s while someone has the dashboard open, every 3 minutes otherwise */
export const FAST_REPORT_MS = 5_000;
export const SLOW_REPORT_MS = 180_000;
/** a workspace whose last report is older than this shows as offline */
export const OFFLINE_AFTER_MS = 6 * 60_000;
/** a signed request whose time is further than this from the service's clock is refused */
export const SIGNATURE_SKEW_MS = 60_000;
/** a claim link lasts this long */
export const CLAIM_TTL_MS = 30 * 60_000;
/** a queued command a workspace has not picked up by then is dropped as expired */
export const COMMAND_TTL_MS = 10 * 60_000;
export const MAX_REPORT_BYTES = 512 * 1024;

export const SIGNATURE_HEADERS = { workspace: "x-omb-workspace", time: "x-omb-time", signature: "x-omb-signature" } as const;

/** the exact bytes a workspace signs with its ed25519 key: method, path with query, time and the body's sha256 (of
 * the empty string for a GET) */
export function signedPayload(method: string, path: string, time: number, bodySha256Hex: string): string {
  return `omb-dashboard-v${DASHBOARD_PROTOCOL}\n${method.toUpperCase()}\n${path}\n${time}\n${bodySha256Hex}`;
}

export type WorkspaceKind = "vps" | "mac" | "linux" | "windows";

export interface MachineReport {
  host: { hostname: string; platform: string; arch: string; cpus: number; cpuModel: string | null };
  cpu: { percent: number; load: [number, number, number] };
  memory: { usedBytes: number; totalBytes: number };
  disk: { usedBytes: number; totalBytes: number; path: string } | null;
  network: { rxBytesPerSec: number; txBytesPerSec: number } | null;
  uptimeSec: number;
  processUptimeSec: number;
  app: { version: string; node: string };
  update: { available: boolean; latest: string | null; how: string | null } | null;
  services: Array<{ id: string; name: string; state: "running" | "stopped" | "unknown"; detail: string | null }>;
}

export interface ComputerReport {
  id: string;
  botId: string | null;
  botName: string | null;
  kind: "vps" | "local-vm" | "team";
  name: string;
  state: "running" | "asleep" | "starting" | "missing" | "unknown";
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  cpuPercent: number | null;
  lastUsedAt: number | null;
  alias: string | null;
}

export interface RoutineReport { id: string; name: string; schedule: string; paused: boolean; nextRunAt: number | null; lastRunAt: number | null }

export interface BotReport {
  id: string;
  name: string;
  /** a MausColor name; the dashboard falls back to blue for one it does not know */
  color: string;
  /** a BotBodyId; null is the default body */
  body: string | null;
  model: string | null;
  engine: string | null;
  computer: "vps" | "local-vm" | "team" | null;
  busy: boolean;
  lastActiveAt: number | null;
  routines: RoutineReport[];
}

export interface ActivityTotals { turns: number; tokens: number; costUsd: number | null }

export interface ActivityReport {
  from: string;
  to: string;
  timeZone: string;
  /** only days with activity, YYYY-MM-DD in the workspace's time zone */
  days: Array<{ date: string } & ActivityTotals>;
  byBot: Array<{ botId: string; botName: string } & ActivityTotals>;
  byModel: Array<{ model: string } & ActivityTotals>;
  totals: ActivityTotals;
}

export interface DevicesReport {
  thisDevice: { label: string; kind: "mac" | "linux" | "windows" | "server" };
  link: { mode: "direct" | "relay" | "off"; connected: boolean; url: string | null; since: number | null; detail: string | null } | null;
  phones: Array<{ id: string; label: string; platform: string | null; pairedAt: number | null; lastSeenAt: number | null }>;
  sessions: Array<{ id: string; label: string; createdAt: number | null; lastSeenAt: number | null; scopes: string[] }>;
}

/** the AI subscriptions the workspace's engines report (GET /api/plan-usage), windows as percent used */
export interface PlansReport {
  providers: Array<{ id: string; name: string; plan: string | null; ok: boolean; windows: Array<{ label: string; usedPercent: number; resetsAt: number | null }> }>;
}

export type CommandKind = "computer.wake" | "computer.sleep" | "phone.revoke" | "session.revoke" | "routine.pause" | "routine.resume";
export const COMMAND_KINDS: readonly CommandKind[] = ["computer.wake", "computer.sleep", "phone.revoke", "session.revoke", "routine.pause", "routine.resume"];

/** `target` is a bot id for computer.*, a phone or session id for *.revoke, a routine id for routine.* */
export interface DashboardCommand { id: string; kind: CommandKind; target: string; issuedAt: number; expiresAt: number }
export interface CommandResult { id: string; ok: boolean; message: string | null; at: number }

/** sections are optional: a workspace sends what changed or what it could read; the service keeps the last of each */
export interface WorkspaceReport {
  v: 1;
  seq: number;
  at: number;
  workspace: { name: string; kind: WorkspaceKind; version: string; platform: string };
  machine?: MachineReport;
  computers?: { provider: "vps" | "local" | "none"; computers: ComputerReport[] };
  bots?: BotReport[];
  activity?: ActivityReport;
  devices?: DevicesReport;
  plans?: PlansReport;
  results?: CommandResult[];
}

/** answer to POST /v1/report and GET /v1/wait */
export interface ReportAnswer { v: 1; watching: boolean; nextReportMs: number; commands: DashboardCommand[] }

/** POST /v1/enroll: a workspace introduces its ed25519 public key (spki der, base64) and gets a one-time claim link */
export interface EnrollRequest { v: 1; publicKey: string; name: string; kind: WorkspaceKind; version: string }
export interface EnrollAnswer { v: 1; workspaceId: string; claimUrl: string; claimExpiresAt: number; dashboardUrl: string }

/** what the dashboard page reads: GET /v1/workspaces */
export type Freshness = "live" | "recent" | "offline" | "waiting";
export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  version: string;
  connectedAt: number;
  lastReportAt: number | null;
  freshness: Freshness;
}

export interface MachineSample { t: number; cpu: number; mem: number; rx: number; tx: number }
export type CommandStatus = "queued" | "sent" | "done" | "failed" | "expired";
export interface CommandView extends DashboardCommand { status: CommandStatus; message: string | null; doneAt: number | null }

/** GET /v1/workspaces/:id: the newest of each section, when it came, recent machine samples and recent commands */
export interface WorkspaceDetail {
  workspace: WorkspaceSummary;
  report: Omit<WorkspaceReport, "v" | "seq" | "results"> | null;
  sectionAt: Partial<Record<"machine" | "computers" | "bots" | "activity" | "devices" | "plans", number>>;
  history: MachineSample[];
  commands: CommandView[];
}

export function freshnessOf(lastReportAt: number | null, now: number): Freshness {
  if (lastReportAt === null) return "waiting";
  const age = now - lastReportAt;
  return age <= 3 * FAST_REPORT_MS ? "live" : age <= OFFLINE_AFTER_MS ? "recent" : "offline";
}

type DashboardParser = (input: unknown) => unknown;
const dashboardInvalid = Symbol("invalid");
const dashboardText = (max = 200): DashboardParser => input => typeof input === "string" ? input.slice(0, max) : dashboardInvalid;
const dashboardName = dashboardText(120);
const dashboardId: DashboardParser = input => typeof input === "string" && input.length > 0 ? input.slice(0, 200) : dashboardInvalid;
const dashboardNumber: DashboardParser = input => typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : dashboardInvalid;
const dashboardBoolean: DashboardParser = input => typeof input === "boolean" ? input : dashboardInvalid;
const dashboardEnum = (...values: string[]): DashboardParser => input => values.includes(input as string) ? input : dashboardInvalid;
const dashboardNullable = (parse: DashboardParser): DashboardParser => input => input === null ? null : parse(input);
const dashboardArray = (parse: DashboardParser, max: number): DashboardParser => input => {
  if (!Array.isArray(input)) return dashboardInvalid;
  const result = input.slice(0, max).map(parse);
  return result.includes(dashboardInvalid) ? dashboardInvalid : result;
};
const dashboardObject = (shape: Record<string, DashboardParser>): DashboardParser => input => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return dashboardInvalid;
  const result: Record<string, unknown> = {};
  for (const [key, parse] of Object.entries(shape)) {
    const value = parse((input as Record<string, unknown>)[key]);
    if (value === dashboardInvalid) return dashboardInvalid;
    result[key] = value;
  }
  return result;
};
const dashboardKind = dashboardEnum("vps", "mac", "linux", "windows");
const dashboardWorkspace = dashboardObject({ name: dashboardName, kind: dashboardKind, version: dashboardText(), platform: dashboardText() });
const dashboardTotals = { turns: dashboardNumber, tokens: dashboardNumber, costUsd: dashboardNullable(dashboardNumber) };
const dashboardSections: Record<string, DashboardParser> = {
  machine: dashboardObject({
    host: dashboardObject({ hostname: dashboardName, platform: dashboardText(), arch: dashboardText(), cpus: dashboardNumber, cpuModel: dashboardNullable(dashboardName) }),
    cpu: dashboardObject({ percent: dashboardNumber, load: input => Array.isArray(input) && input.length === 3 ? dashboardArray(dashboardNumber, 3)(input) : dashboardInvalid }),
    memory: dashboardObject({ usedBytes: dashboardNumber, totalBytes: dashboardNumber }),
    disk: dashboardNullable(dashboardObject({ usedBytes: dashboardNumber, totalBytes: dashboardNumber, path: dashboardText() })),
    network: dashboardNullable(dashboardObject({ rxBytesPerSec: dashboardNumber, txBytesPerSec: dashboardNumber })),
    uptimeSec: dashboardNumber, processUptimeSec: dashboardNumber,
    app: dashboardObject({ version: dashboardText(), node: dashboardText() }),
    update: dashboardNullable(dashboardObject({ available: dashboardBoolean, latest: dashboardNullable(dashboardText()), how: dashboardNullable(dashboardText()) })),
    services: dashboardArray(dashboardObject({ id: dashboardId, name: dashboardName, state: dashboardEnum("running", "stopped", "unknown"), detail: dashboardNullable(dashboardText()) }), 20),
  }),
  computers: dashboardObject({ provider: dashboardEnum("vps", "local", "none"), computers: dashboardArray(dashboardObject({
    id: dashboardId, botId: dashboardNullable(dashboardId), botName: dashboardNullable(dashboardName), kind: dashboardEnum("vps", "local-vm", "team"),
    name: dashboardName, state: dashboardEnum("running", "asleep", "starting", "missing", "unknown"), memoryBytes: dashboardNullable(dashboardNumber),
    memoryLimitBytes: dashboardNullable(dashboardNumber), cpuPercent: dashboardNullable(dashboardNumber), lastUsedAt: dashboardNullable(dashboardNumber), alias: dashboardNullable(dashboardName),
  }), 200) }),
  bots: dashboardArray(dashboardObject({
    id: dashboardId, name: dashboardName, color: dashboardText(), body: dashboardNullable(dashboardText()), model: dashboardNullable(dashboardText()),
    engine: dashboardNullable(dashboardText()), computer: dashboardNullable(dashboardEnum("vps", "local-vm", "team")), busy: dashboardBoolean,
    lastActiveAt: dashboardNullable(dashboardNumber), routines: dashboardArray(dashboardObject({ id: dashboardId, name: dashboardName, schedule: dashboardText(),
      paused: dashboardBoolean, nextRunAt: dashboardNullable(dashboardNumber), lastRunAt: dashboardNullable(dashboardNumber) }), 50),
  }), 200),
  activity: dashboardObject({ from: dashboardText(), to: dashboardText(), timeZone: dashboardText(),
    days: dashboardArray(dashboardObject({ date: dashboardText(), ...dashboardTotals }), 400),
    byBot: dashboardArray(dashboardObject({ botId: dashboardId, botName: dashboardName, ...dashboardTotals }), 200),
    byModel: dashboardArray(dashboardObject({ model: dashboardText(), ...dashboardTotals }), 100), totals: dashboardObject(dashboardTotals),
  }),
  devices: dashboardObject({ thisDevice: dashboardObject({ label: dashboardName, kind: dashboardEnum("mac", "linux", "windows", "server") }),
    link: dashboardNullable(dashboardObject({ mode: dashboardEnum("direct", "relay", "off"), connected: dashboardBoolean, url: dashboardNullable(dashboardText()),
      since: dashboardNullable(dashboardNumber), detail: dashboardNullable(dashboardText()) })),
    phones: dashboardArray(dashboardObject({ id: dashboardId, label: dashboardName, platform: dashboardNullable(dashboardText()), pairedAt: dashboardNullable(dashboardNumber), lastSeenAt: dashboardNullable(dashboardNumber) }), 50),
    sessions: dashboardArray(dashboardObject({ id: dashboardId, label: dashboardName, createdAt: dashboardNullable(dashboardNumber), lastSeenAt: dashboardNullable(dashboardNumber), scopes: dashboardArray(dashboardText(), 50) }), 100),
  }),
  plans: dashboardObject({ providers: dashboardArray(dashboardObject({ id: dashboardId, name: dashboardName, plan: dashboardNullable(dashboardText()), ok: dashboardBoolean,
    windows: dashboardArray(dashboardObject({ label: dashboardName, usedPercent: dashboardNumber, resetsAt: dashboardNullable(dashboardNumber) }), 20) }), 20) }),
  results: dashboardArray(dashboardObject({ id: dashboardId, ok: dashboardBoolean, message: dashboardNullable(dashboardText()), at: dashboardNumber }), 50),
};

/** bounded version 1 report; malformed optional sections are omitted independently. */
export function parseWorkspaceReport(input: unknown): WorkspaceReport | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const workspace = dashboardWorkspace(value.workspace);
  if (value.v !== 1 || !Number.isSafeInteger(value.seq) || (value.seq as number) < 1 || dashboardNumber(value.at) === dashboardInvalid || workspace === dashboardInvalid) return null;
  const report: Record<string, unknown> = { v: 1, seq: value.seq, at: value.at, workspace };
  for (const [key, parse] of Object.entries(dashboardSections)) {
    if (value[key] === undefined) continue;
    const section = parse(value[key]);
    if (section !== dashboardInvalid) report[key] = section;
  }
  return report as unknown as WorkspaceReport;
}

/** bounded enrollment fields; the service verifies that the key is ed25519 spki der. */
export function parseEnrollRequest(input: unknown): EnrollRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.v !== 1 || typeof value.publicKey !== "string" || value.publicKey.length > 2000 || !value.publicKey.length) return null;
  const parsed = dashboardObject({ name: dashboardName, kind: dashboardKind, version: dashboardText() })(input);
  if (parsed === dashboardInvalid) return null;
  return { v: 1, publicKey: value.publicKey, ...(parsed as Omit<EnrollRequest, "v" | "publicKey">) };
}
