import { useCallback, useEffect, useRef, useState } from "react";
import { CSRF_COOKIE, CSRF_HEADER } from "../../../../shared/account-api";

export class AdminApiError extends Error {
  readonly status: number; readonly code: string | null;
  constructor(message: string, status: number, code: string | null) { super(message); this.status = status; this.code = code; }
}

let fetchedCsrf: string | null = null;
/** the CSRF cookie, or the token the account read hands out when the cookie is missing */
async function csrf() {
  const raw = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1) ?? "";
  try { if (raw) return decodeURIComponent(raw); } catch { return raw; }
  if (fetchedCsrf) return fetchedCsrf;
  const me = await fetch("/v1/me", { credentials: "same-origin" }).then((res) => res.json() as Promise<{ csrfToken?: string }>).catch(() => null);
  fetchedCsrf = me?.csrfToken ?? null;
  return fetchedCsrf ?? "";
}

export async function adminCall<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(`/v1/admin${path}`, { method, credentials: "same-origin", signal: init.signal,
      headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(method === "GET" ? {} : { [CSRF_HEADER]: await csrf() }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AdminApiError("can't reach the account service. check your connection.", 0, "offline");
  }
  const data = await res.json().catch(() => null) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new AdminApiError(data?.error ?? "the request failed.", res.status, data?.code ?? null);
  return data as T;
}

/** one admin read: loading, its error, and a reload; an older answer never lands on a newer key */
export function useAdmin<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const current = useRef(path);
  current.current = path;
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setLoading(true);
    adminCall<T>(path, { signal: controller.signal })
      .then((answer) => { if (current.current === path) { setData(answer); setError(null); } })
      .catch((err: unknown) => { if ((err as Error).name !== "AbortError" && current.current === path) setError(err instanceof AdminApiError ? err : new AdminApiError("the request failed.", 0, null)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, tick]);
  useEffect(() => {
    if (!refreshMs) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") setTick((n) => n + 1); }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

export interface FunnelStep { id: string; label: string; count: number; total: number }
export interface Overview {
  now: number; days: number; range: string[];
  totals: { accounts: number; newAccounts: number; activeToday: number; wau: number; mau: number; paying: number; waitlist: number | null; clouds: number; devices: number };
  series: { signups: number[]; waitlist: number[]; active: number[]; visitors: number[]; views: number[]; apps: number[] };
  funnel: FunnelStep[];
  clouds: Array<{ state: string; count: number }>;
  bots: { workspaces: number; bots: number; turns30d: number };
  platforms: Array<{ platform: string; count: number }>;
  spend: { exposed: boolean; note: string };
}
export interface UserRow {
  id: string; email: string; name: string | null; createdAt: number; methods: string[]; plan: { plan: string | null; status: string } | null;
  clouds: number; devices: number; platforms: string[]; lastSeenAt: number | null; optOut: boolean;
}
export interface CloudRow {
  id: string; name: string; accountId: string; owner: string | null; kind: string; plan: string; placement: string; region: string; regionLabel: string; status: string;
  setupStep: string | null; backend: string | null; origin: string | null; spec: { vcpu: number; ramGb: number; diskGb: number }; createdAt: number; provisionedAt: number | null;
  powerSince: number; lastReportAt: number | null; suspended: boolean; ended: boolean; destroyAt: number | null; error: string | null;
  subscription: { status: string; periodEnd: number | null } | null; actions: { pause: boolean; resume: boolean; delete: boolean };
}
export interface TimelineItem { name: string; at: number; props: Record<string, string | number | boolean>; source: "event" | "record" }
export interface UserDetail {
  account: { id: string; email: string; name: string | null; createdAt: number; lastSeenAt: number | null; optOut: boolean };
  methods: string[]; plan: UserRow["plan"];
  subscriptions: Array<{ id: string; plan: string | null; status: string; totalCents: number; periodEnd: number | null; cancelAtPeriodEnd: boolean; createdAt: number }>;
  payments: Array<{ id: string; amountCents: number; currency: string; status: string; createdAt: number }>;
  devices: Array<{ id: string; kind: string; name: string; platform: string | null; appVersion: string | null; createdAt: number; lastSeenAt: number }>;
  clouds: CloudRow[];
  workspaces: Array<{ id: string; name: string; kind: string; version: string; connectedAt: number; lastReportAt: number | null; bots: number; turns30d: number; computers: number }>;
  timeline: TimelineItem[];
}
export interface EventRow { id: string; name: string; at: number; accountId: string | null; email: string | null; props: Record<string, string | number | boolean>; ctx?: Record<string, unknown> }
export interface WaitlistPage {
  configured: boolean; count?: number; total: number; offset?: number; limit?: number;
  entries: Array<{ email: string; position: number; createdAt: number; source: string | null; ref: string | null }>;
  days?: string[]; series?: number[];
  brevo: { state: "not_configured" | "synced" | "behind" | "error"; listCount: number | null; waitlistCount: number | null; checkedAt: number | null };
}
export interface Health {
  now: number;
  service: { version: string | null; environment: string; startedAt: number; uptimeSec: number; node: string; rssMb: number };
  database: { ok: boolean; detail: string };
  analytics: { ok: boolean; detail: string; latencyMs: number | null; written: number; failed: number; dropped: number; lastFailureAt: number | null };
  backup: { configured: boolean; at: number | null; ageHours: number | null; ok: boolean | null };
  errors: { service: { hour: number; day: number; sinceStart: number }; page: { hour: number; day: number; sinceStart: number }; spooled: number };
  checks: Array<{ name: string; url: string; ok: boolean; status: number | null; latencyMs: number | null }>;
}
export interface AuditEntry { id: string; at: number; actor: string; actorEmail: string | null; action: string; target: string | null; detail: Record<string, string | number | boolean | null> }
