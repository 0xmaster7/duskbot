import { t } from "./i18n";
import { en, type LocaleKey } from "@/locales";

export const ACTIVITY_WHATS = ["all", "approvals", "decisions", "config", "people", "session", "webhook", "bot-api", "mcp", "engine", "bot", "budget", "visibility"] as const;
export type ActivityWhat = typeof ACTIVITY_WHATS[number];

export type ActivityEntry =
  | {
      type: "approval";
      at: string;
      who: string;
      what: string;
      source: string;
      bot?: string;
      tool?: string;
      summary?: string;
      threadId: string;
      requestId?: string;
    }
  | {
      type: "admin";
      at: string;
      who: string;
      what: string;
      action: string;
      target?: { kind: string; id?: string; name?: string };
      changed?: string[];
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    };

export interface ActivityFilters {
  who: string;
  what: ActivityWhat;
  from: string;
  to: string;
}

export function activityQuery(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  if (filters.who.trim()) params.set("who", filters.who.trim());
  if (filters.what !== "all") params.set("what", filters.what);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function whoLabel(who: string): string {
  if (who === "This computer") return t("activity.actor.loopback");
  if (who === "Local service") return t("activity.actor.worker");
  if (who === "Command line") return t("activity.actor.cli");
  return who || "-";
}

function known(key: string): key is LocaleKey {
  return Object.hasOwn(en, key);
}

export function describeEntry(entry: ActivityEntry): string {
  if (entry.type === "approval") {
    const decisionKey = `activity.decision.${entry.what}`;
    const decision = known(decisionKey) ? t(decisionKey) : entry.what;
    const line = entry.tool ? t("activity.approvalLine", { decision, tool: entry.tool }) : decision;
    return entry.bot ? `${line} ${t("activity.approvalIn", { bot: entry.bot })}` : line;
  }
  const actionKey = `activity.action.${entry.action}`;
  const action = known(actionKey) ? t(actionKey) : entry.action;
  const target = entry.target?.name ?? entry.target?.id;
  return target ? `${action}: ${target}` : action;
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
