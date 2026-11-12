// what a workspace tells the account service about how it is used: one record per bot turn and per routine run, plus a
// count snapshot. every value is a word from a fixed list, a count or a time. message text, prompts, file contents,
// urls, tool arguments, error messages and names never reach these records: the workspace maps them to words here first.
import { CURATED_CONNECTOR_SLUGS } from "./connector-curated.ts";
import { traceToolLook } from "./usage-trace.ts";

export const USAGE_ENGINES = ["claude", "codex", "gemini", "grok", "opencode", "cursor", "kimi", "deepseek", "qwen", "copilot", "api", "other"] as const;
export type UsageEngine = (typeof USAGE_ENGINES)[number];
const ENGINE_BY_DRIVER: Readonly<Record<string, UsageEngine>> = {
  claudeAgent: "claude", codex: "codex", geminiAgent: "gemini", grokAgent: "grok", grok: "grok", opencodeGo: "opencode", cursorAgent: "cursor", kimiAgent: "kimi",
  deepseekAgent: "deepseek", qwenAgent: "qwen", copilotAgent: "copilot", "openai-compat": "api", mistral: "api", cerebras: "api", groq: "api", greenference: "api",
  meta: "api", minimax: "api",
};
/** an engine's family from its driver kind; never the instance id or a model name someone typed */
export const engineFamily = (driverKind: unknown): UsageEngine => (typeof driverKind === "string" && ENGINE_BY_DRIVER[driverKind]) || "other";

/** what a turn touched, by kind: the trace's tool icons, folded */
export const USAGE_TOOLS = ["browser", "computer", "terminal", "files", "web", "memory", "routine", "page", "widget", "bots", "phone", "image", "data", "app", "mcp", "other"] as const;
export type UsageTool = (typeof USAGE_TOOLS)[number];
const TOOL_OF_ICON: Readonly<Record<string, UsageTool>> = {
  browser: "browser", computer: "computer", terminal: "terminal", files: "files", search: "web", web: "web", memory: "memory", routine: "routine", page: "page",
  widget: "widget", bots: "bots", phone: "phone", image: "image", data: "data", app: "app", mcp: "mcp", plan: "other", tool: "other",
};
export const USAGE_APPS: readonly string[] = CURATED_CONNECTOR_SLUGS;
const APP_SET = new Set<string>(USAGE_APPS);

export const USAGE_CATEGORIES = ["email", "calendar", "messaging", "social", "docs", "coding", "data", "research", "computer", "files", "image", "chat", "other"] as const;
export type UsageCategory = (typeof USAGE_CATEGORIES)[number];
const CATEGORY_OF_APP: Readonly<Record<string, UsageCategory>> = {
  gmail: "email", googlecalendar: "calendar", slack: "messaging", discord: "messaging", twitter: "social", reddit: "social",
  googledocs: "docs", googledrive: "docs", notion: "docs", dropbox: "docs", figma: "docs", github: "coding", linear: "coding", sentry: "coding", jira: "coding",
  googlesheets: "data", airtable: "data", hubspot: "data", salesforce: "data", stripe: "data", posthog: "data", asana: "docs", trello: "docs", zapier: "other",
};
// an app says the most about what the turn was for, so apps go first, in this order of strength
const APP_ORDER: readonly UsageCategory[] = ["email", "calendar", "social", "messaging", "coding", "data", "docs", "other"];

/** a turn's coarse purpose from what it touched, worked out on the workspace; no text is read */
export function categorize(input: { tools: readonly string[]; apps: readonly string[] }): UsageCategory {
  const fromApps = new Set(input.apps.map(app => CATEGORY_OF_APP[app]).filter((value): value is UsageCategory => !!value));
  for (const category of APP_ORDER) if (fromApps.has(category)) return category;
  const tools = new Set(input.tools);
  if (tools.has("terminal")) return "coding";
  if (tools.has("data")) return "data";
  if (tools.has("image")) return "image";
  if (tools.has("computer") || tools.has("phone")) return "computer";
  if (tools.has("browser") || tools.has("web")) return "research";
  if (tools.has("files")) return "files";
  if (tools.has("app") || tools.has("mcp")) return "other";
  const meaningful = [...tools].filter(tool => tool !== "memory" && tool !== "other" && tool !== "widget");
  return meaningful.length ? "other" : "chat";
}

/** each tool name a turn called as a tool kind and, for a connected app, its curated slug or "other_app" */
export function toolSignals(names: readonly string[]): { tools: UsageTool[]; apps: string[] } {
  const tools = new Set<UsageTool>(), apps = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string") continue;
    const look = traceToolLook(name);
    tools.add(TOOL_OF_ICON[look.icon] ?? "other");
    if (look.icon === "app") apps.add(look.app && APP_SET.has(look.app) ? look.app : "other_app");
  }
  return { tools: [...tools].sort(), apps: [...apps].sort() };
}

export const USAGE_REASONS = ["rate_limit", "quota", "auth", "timeout", "network", "context", "refused", "crashed", "tool", "unknown"] as const;
export type UsageReason = (typeof USAGE_REASONS)[number];
const REASON_PATTERNS: ReadonlyArray<[RegExp, UsageReason]> = [
  [/rate.?limit|too many requests|\b429\b|overloaded|\b529\b/i, "rate_limit"],
  [/quota|usage limit|credit|billing|insufficient|out of|exceeded your|plan limit/i, "quota"],
  [/auth|sign(?:ed)? ?in|log(?:ged)? ?in|unauthori[sz]ed|forbidden|\b401\b|\b403\b|api key|token (?:expired|invalid)|expired/i, "auth"],
  [/time ?out|timed out|took too long|stalled|deadline/i, "timeout"],
  [/network|econn|enotfound|socket|fetch failed|unreachable|dns|offline|\b50[234]\b/i, "network"],
  [/context|too long|max(?:imum)? tokens|prompt is too|token limit/i, "context"],
  [/refus|policy|safety|blocked|not allowed|denied/i, "refused"],
  [/crash|exited|exit code|killed|segfault|panic|spawn|signal/i, "crashed"],
  [/tool/i, "tool"],
];
/** an error line as a reason code, on the workspace: the line itself is never sent */
export function failureReason(text: unknown): UsageReason {
  if (typeof text !== "string" || !text) return "unknown";
  const line = text.slice(0, 400);
  for (const [pattern, reason] of REASON_PATTERNS) if (pattern.test(line)) return reason;
  return "unknown";
}

/** who started the turn: the person at this workspace's own app, the person from another device (a phone, a browser,
 * another computer), or no person */
export const USAGE_FROM = ["app", "remote", "routine", "bot", "helper"] as const;
export type UsageFrom = (typeof USAGE_FROM)[number];
/** where the bot ran */
export const USAGE_PLACES = ["desktop", "cloud", "server"] as const;
export type UsagePlace = (typeof USAGE_PLACES)[number];
export const USAGE_OUTCOMES = ["ok", "failed", "cancelled"] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];
export const USAGE_RUN_TRIGGERS = ["schedule", "event", "webhook", "manual", "api"] as const;
export type UsageRunTrigger = (typeof USAGE_RUN_TRIGGERS)[number];

export interface UsageTurn {
  /** a random id, so a report sent twice counts once */
  id: string;
  at: number;
  engine: UsageEngine;
  outcome: UsageOutcome;
  reason?: UsageReason;
  /** the whole turn, start to end */
  ms: number;
  tools: UsageTool[];
  apps: string[];
  category: UsageCategory;
  from: UsageFrom;
  place: UsagePlace;
  /** the turn was in a room (a group chat) */
  room: boolean;
}
export interface UsageRun { id: string; at: number; trigger: UsageRunTrigger; outcome: UsageOutcome; reason?: UsageReason }
/** counts only: how much of each thing the workspace has */
export interface UsageSnapshot { bots: number; rooms: number; routines: number; webhooks: number; appEvents: number; skills: number }
export const FRUSTRATION_SIGNALS = ["thumbs_down", "stopped", "retried", "failed", "corrective", "shouting", "swearing"] as const;
export type FrustrationSignal = (typeof FRUSTRATION_SIGNALS)[number];
/** a chat that went badly: what the person did, what the turn touched, and an abstract line the person's own engine
 * wrote on the workspace and `scrubSummary` cleaned there. never their messages. */
export interface UsageFrustration {
  id: string;
  at: number;
  engine: UsageEngine;
  category: UsageCategory;
  tools: UsageTool[];
  apps: string[];
  reason?: UsageReason;
  signals: FrustrationSignal[];
  /** follow-ups that repeated or rephrased the same request */
  retries: number;
  summary?: string;
}
/** a weekly line about what one person uses Dusk for, written by their own engine on the workspace and scrubbed there */
export interface UsageDigest { id: string; at: number; turns: number; days: number; summary: string }
export interface UsageReport { turns: UsageTurn[]; runs: UsageRun[]; frustrations?: UsageFrustration[]; digests?: UsageDigest[]; snapshot?: UsageSnapshot }

export const USAGE_TURN_KEYS = ["id", "at", "engine", "outcome", "reason", "ms", "tools", "apps", "category", "from", "place", "room"] as const;
export const USAGE_RUN_KEYS = ["id", "at", "trigger", "outcome", "reason"] as const;
export const USAGE_SNAPSHOT_KEYS = ["bots", "rooms", "routines", "webhooks", "appEvents", "skills"] as const;
export const USAGE_FRUSTRATION_KEYS = ["id", "at", "engine", "category", "tools", "apps", "reason", "signals", "retries", "summary"] as const;
export const MAX_REPORT_TURNS = 500;
export const MAX_REPORT_FRUSTRATIONS = 50;
export const SUMMARY_MAX = 240, DIGEST_MAX = 700;
export const USAGE_DIGEST_KEYS = ["id", "at", "turns", "days", "summary"] as const;
export const MAX_REPORT_RUNS = 200;

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
const count = (value: unknown, max = 1e12): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < max;
const DAY = 86_400_000;
const time = (value: unknown, now: number) => count(value, 1e14) && value > now - 30 * DAY && value < now + 10 * 60_000;

/** a turn exactly as it may be sent and stored, or null: unknown keys are dropped and any bad value drops the record */
export function cleanUsageTurn(input: unknown, now = Date.now()): UsageTurn | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id) || !time(v.at, now) || !oneOf(USAGE_ENGINES, v.engine) || !oneOf(USAGE_OUTCOMES, v.outcome) || !count(v.ms, 7 * DAY)
    || !Array.isArray(v.tools) || !Array.isArray(v.apps) || !oneOf(USAGE_CATEGORIES, v.category) || !oneOf(USAGE_FROM, v.from) || !oneOf(USAGE_PLACES, v.place) || typeof v.room !== "boolean") return null;
  const tools = [...new Set(v.tools.slice(0, USAGE_TOOLS.length).filter((tool): tool is UsageTool => oneOf(USAGE_TOOLS, tool)))].sort();
  const apps = [...new Set(v.apps.slice(0, 20).filter((app): app is string => typeof app === "string" && (APP_SET.has(app) || app === "other_app")))].sort();
  const reason = v.outcome === "ok" ? undefined : oneOf(USAGE_REASONS, v.reason) ? v.reason : "unknown";
  return { id: v.id, at: v.at as number, engine: v.engine, outcome: v.outcome, ...(reason ? { reason } : {}), ms: v.ms, tools, apps, category: v.category, from: v.from, place: v.place, room: v.room };
}

export function cleanUsageRun(input: unknown, now = Date.now()): UsageRun | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id) || !time(v.at, now) || !oneOf(USAGE_RUN_TRIGGERS, v.trigger) || !oneOf(USAGE_OUTCOMES, v.outcome)) return null;
  const reason = v.outcome === "ok" ? undefined : oneOf(USAGE_REASONS, v.reason) ? v.reason : "unknown";
  return { id: v.id, at: v.at as number, trigger: v.trigger, outcome: v.outcome, ...(reason ? { reason } : {}) };
}

/** a frustration record as it may be sent and stored; a summary the scrubber would change is dropped, the record kept */
export function cleanUsageFrustration(input: unknown, now = Date.now()): UsageFrustration | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id) || !time(v.at, now) || !oneOf(USAGE_ENGINES, v.engine) || !oneOf(USAGE_CATEGORIES, v.category)
    || !Array.isArray(v.tools) || !Array.isArray(v.apps) || !Array.isArray(v.signals) || !count(v.retries, 100)) return null;
  const signals = [...new Set(v.signals.filter((signal): signal is FrustrationSignal => oneOf(FRUSTRATION_SIGNALS, signal)))].sort();
  if (!signals.length) return null;
  const tools = [...new Set(v.tools.slice(0, USAGE_TOOLS.length).filter((tool): tool is UsageTool => oneOf(USAGE_TOOLS, tool)))].sort();
  const apps = [...new Set(v.apps.slice(0, 20).filter((app): app is string => typeof app === "string" && (APP_SET.has(app) || app === "other_app")))].sort();
  const summary = typeof v.summary === "string" && scrubSummary(v.summary) === v.summary ? v.summary : undefined;
  return { id: v.id, at: v.at as number, engine: v.engine, category: v.category, tools, apps, ...(oneOf(USAGE_REASONS, v.reason) ? { reason: v.reason } : {}), signals,
    retries: v.retries, ...(summary ? { summary } : {}) };
}

const EMAIL = /[^\s@]+@[^\s@]+/g, URL_LIKE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|dev|app|co|bot|me|so|xyz|in|uk|de)\b\S*/gi;
const HANDLE = /(?:^|\s)[@#]\w+/g, DIGITS = /\S*\d\S*/g, QUOTED = /["“”«»`][^"“”«»`]*["“”«»`]|(?<=^|\s)'[^']{2,}'(?=$|[\s.,;:!?])/g, FILE = /\b[\w-]+\.[a-z0-9]{1,5}\b/gi;
/** an engine's summary as one short lowercase line with no addresses, links, handles, numbers, quotes, file names or
 * capitalised names; null when cleaning took out too much for what is left to be trusted */
export function scrubSummary(raw: unknown, max = SUMMARY_MAX): string | null {
  if (typeof raw !== "string") return null;
  const original = raw.replace(/\s+/g, " ").trim().slice(0, max * 2.5);
  if (original.length < 12) return null;
  let text = original.replace(EMAIL, " ").replace(URL_LIKE, " ").replace(HANDLE, " ").replace(QUOTED, " ").replace(FILE, " ").replace(DIGITS, " ");
  // a capitalised word that does not start a sentence is taken as a name
  text = text.replace(/(^|[.!?]\s+)?(\b\p{Lu}[\p{L}'-]*)/gu, (match, start: string | undefined, word: string) => start !== undefined || /^(?:I|AI|OK)$/.test(word) ? match : " ");
  text = text.replace(/[^\p{L}\s,.;:!?'()-]/gu, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim().toLowerCase();
  if (text.length < 12 || text.length < original.length * 0.7) return null;
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}.` : text;
}

export function cleanUsageDigest(input: unknown, now = Date.now()): UsageDigest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id) || !time(v.at, now) || !count(v.turns, 100_000) || !count(v.days, 8) || typeof v.summary !== "string" || scrubSummary(v.summary, DIGEST_MAX) !== v.summary) return null;
  return { id: v.id, at: v.at as number, turns: v.turns, days: v.days, summary: v.summary };
}

export function cleanUsageSnapshot(input: unknown): UsageSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of USAGE_SNAPSHOT_KEYS) { if (!count(v[key], 100_000)) return null; out[key] = v[key] as number; }
  return out as unknown as UsageSnapshot;
}

/** a report's usage section, bounded; null when nothing in it is usable */
export function cleanUsageReport(input: unknown, now = Date.now()): UsageReport | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  const turns = Array.isArray(v.turns) ? v.turns.slice(0, MAX_REPORT_TURNS).map(item => cleanUsageTurn(item, now)).filter((item): item is UsageTurn => !!item) : [];
  const runs = Array.isArray(v.runs) ? v.runs.slice(0, MAX_REPORT_RUNS).map(item => cleanUsageRun(item, now)).filter((item): item is UsageRun => !!item) : [];
  const frustrations = Array.isArray(v.frustrations) ? v.frustrations.slice(0, MAX_REPORT_FRUSTRATIONS).map(item => cleanUsageFrustration(item, now)).filter((item): item is UsageFrustration => !!item) : [];
  const digests = Array.isArray(v.digests) ? v.digests.slice(0, 2).map(item => cleanUsageDigest(item, now)).filter((item): item is UsageDigest => !!item) : [];
  const snapshot = v.snapshot === undefined ? null : cleanUsageSnapshot(v.snapshot);
  if (!turns.length && !runs.length && !frustrations.length && !digests.length && !snapshot) return null;
  return { turns, runs, ...(frustrations.length ? { frustrations } : {}), ...(digests.length ? { digests } : {}), ...(snapshot ? { snapshot } : {}) };
}

/** a routine run's start as a usage trigger */
export function runTrigger(run: { triggerSource?: string; eventSource?: string; manual?: boolean }): UsageRunTrigger {
  if (run.triggerSource === "webhook") return run.eventSource ? "event" : "webhook";
  if (run.triggerSource === "manual" || run.manual) return "manual";
  if (run.triggerSource === "api") return "api";
  return "schedule";
}
