import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { createAuth } from "../auth/index.ts";
import type { createBilling } from "../billing/index.ts";
import { BILLING_CONFIG } from "../billing/plans.ts";
import type { StoredCloud } from "../clouds/types.ts";
import type { StoredWorkspace } from "../store.ts";
import type { Analytics } from "../analytics/index.ts";
import { EVENTS, EVENT_NAMES, isEventName } from "../analytics/events.ts";
import type { StoredEvent } from "../analytics/sink.ts";
import { brevoChecker, waitlistCsv, type WaitlistSource } from "./waitlist.ts";
import { healthTargets, newestBackup, probe, spoolCount, type ErrorCounter } from "./health.ts";
import { AnalyticsRouteError, createAnalyticsRoutes } from "./analytics-routes.ts";
import { DAY, choseCloud, dayKey, dayRange, funnel, isPaying, perDay, wasPaid, workspaceTurns } from "./metrics.ts";

export class AdminError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
type Auth = ReturnType<typeof createAuth>;
type Billing = ReturnType<typeof createBilling>;
export interface AdminOptions {
  /** DUSK_ADMIN_EMAILS: the accounts allowed in, by email; empty lets nobody in */
  emails: string[];
  auth: Auth;
  billing: Billing;
  workspaces: () => StoredWorkspace[];
  analytics: Analytics;
  waitlist: WaitlistSource | null;
  now: () => number;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  errors: ErrorCounter;
  service: { version: string | null; startedAt: number; environment: string; dataDir: string; backupDir: string | null; database: () => { ok: boolean; detail: string } | null };
  readBody(req: IncomingMessage): Promise<Buffer>;
  bodyObject(body: Buffer): Record<string, unknown>;
  json(res: ServerResponse, status: number, data: unknown): void;
}

const rethrow = (error: unknown): never => {
  if (error instanceof AnalyticsRouteError) throw new AdminError(error.status, error.code, error.message);
  throw error;
};
export const parseAdminEmails = (value: string | undefined) => [...new Set((value ?? "").split(",").map(item => item.trim().toLowerCase()).filter(item => /^[^\s@]+@[^\s@]+$/.test(item)))];
const ACTIVE_NAMES = EVENT_NAMES.filter(name => "active" in EVENTS[name]);
const bundleLabel = (id: string | null | undefined) => BILLING_CONFIG.bundles.find(bundle => bundle.id === id)?.label.toLowerCase() ?? (id ? "custom" : null);
const regionLabel = (id: string) => BILLING_CONFIG.regions.find(region => region.id === id)?.label.toLowerCase() ?? id;
const int = (value: string | null, fallback: number, min: number, max: number) => {
  const n = value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new AdminError(400, "invalid_request", "Invalid request.");
  return n;
};

export function createAdmin(options: AdminOptions) {
  const { auth, billing, analytics, now } = options;
  const allowed = new Set(options.emails.map(email => email.toLowerCase()));
  const env = options.env ?? process.env;
  const brevo = brevoChecker({ apiKey: env.DUSK_BREVO_API_KEY, listId: env.DUSK_BREVO_WAITLIST_LIST_ID, fetch: options.fetch, now });
  const targets = healthTargets(env.DUSK_ADMIN_HEALTH_URLS);
  const deep = createAnalyticsRoutes({ auth, billing, analytics, workspaces: options.workspaces, now, actor: id => auth.directory().accounts.find(account => account.id === id)?.email ?? null });

  /** every admin route: a signed-in web session (401), an allowed email (403), and the CSRF header on changes */
  function gate(req: IncomingMessage, mutation: boolean) {
    const owner = auth.requireWeb(req, { mutation });
    if (!allowed.has(owner.email.toLowerCase())) throw new AdminError(403, "not_admin", "This account is not an admin.");
    return owner;
  }
  function audit(actor: string, action: string, target: string | null, detail: Record<string, string | number | boolean | null> = {}) {
    return analytics.sink.audit({ id: `aud_${randomBytes(12).toString("base64url")}`, at: now(), actor, action, target, detail }).catch(() => { analytics.stats.failed++; });
  }

  const directory = () => auth.directory();
  const store = () => billing.store.state;
  const allClouds = () => billing.clouds.all?.() ?? [];
  function subsOf(accountId: string) { return billing.service.subscriptions(accountId); }
  function planOf(accountId: string) {
    const subs = subsOf(accountId).filter(sub => sub.status !== "ended" && sub.status !== "pending").sort((a, b) => b.createdAt - a.createdAt);
    return subs[0] ? { plan: bundleLabel(subs[0].bundle), status: subs[0].status } : null;
  }
  function lastSeen(accountId: string, sessions = directory().sessions) {
    return sessions.filter(session => session.accountId === accountId).reduce<number | null>((best, session) => best === null || session.lastSeenAt > best ? session.lastSeenAt : best, null);
  }
  function cloudRow(c: StoredCloud, emails: Map<string, string>) {
    const view = billing.clouds.view(c), sub = store().subscriptions.find(item => item.id === c.subscriptionId);
    const status = view.status, managed = !!billing.clouds.managed && !!c.managed;
    const usable = !c.ended && !(c.destroyAt !== null && c.destroyAt <= now());
    return {
      id: c.id, name: c.name, accountId: c.accountId, owner: emails.get(c.accountId) ?? null, kind: c.kind, plan: BILLING_CONFIG.desktops[c.kind]?.label.toLowerCase() ?? c.kind,
      placement: c.placement, region: c.region, regionLabel: regionLabel(c.region), status, setupStep: c.setupStep, backend: c.backend ?? null, origin: c.origin,
      spec: c.spec, createdAt: c.createdAt, provisionedAt: c.provisionedAt ?? null, powerSince: c.powerSince, lastReportAt: view.lastReportAt,
      suspended: c.suspended !== null, ended: !!c.ended, destroyAt: c.destroyAt, error: c.error, subscription: sub ? { status: sub.status, periodEnd: sub.currentPeriodEnd } : null,
      actions: {
        pause: c.suspended === null && usable && ["running", "sleeping"].includes(c.status),
        resume: c.suspended !== null ? c.status === "suspended" && usable : usable && ["stopped", "sleeping"].includes(c.status),
        delete: managed && !!c.ended && c.status !== "destroyed" && c.status !== "destroying",
      },
    };
  }
  const emailMap = () => new Map(directory().accounts.map(account => [account.id, account.email]));

  async function overview(days: number) {
    const time = now(), range = dayRange(time, days), since = Date.parse(`${range[0]}T00:00:00Z`);
    const { accounts, sessions } = directory();
    const [daily, waitlistDays, waitlistCount, wau, mau, marked] = await Promise.all([
      analytics.sink.daily(["active_accounts", "site_visitors", "site_view", "app_active"], range[0]!, range.at(-1)!),
      options.waitlist?.byDay(since).catch(() => []) ?? Promise.resolve([]),
      options.waitlist?.count().catch(() => null) ?? Promise.resolve(null),
      analytics.sink.accounts(ACTIVE_NAMES, time - 7 * DAY), analytics.sink.accounts(ACTIVE_NAMES, time - 30 * DAY),
      Promise.all(["onboarding_done", "app_paired", "first_bot_reply", "plan_chosen"].map(name => analytics.sink.accounts([name], since))),
    ]);
    const series = (name: string) => perDay(range, daily.filter(row => row.name === name));
    const seenToday = new Set(sessions.filter(session => session.lastSeenAt >= Date.parse(`${range.at(-1)}T00:00:00Z`)).map(session => session.accountId));
    const activeSeries = series("active_accounts");
    const clouds = allClouds();
    const byState = new Map<string, number>();
    for (const c of clouds) { const status = billing.clouds.view(c).status; byState.set(status, (byState.get(status) ?? 0) + 1); }
    const owned = options.workspaces().filter(ws => ws.ownerAccountId !== null);
    const sinceDay = dayKey(time - 29 * DAY);
    return {
      now: time, days, range,
      totals: {
        accounts: accounts.length, newAccounts: accounts.filter(account => account.createdAt >= since).length,
        activeToday: Math.max(activeSeries.at(-1) ?? 0, seenToday.size), wau: wau.size, mau: mau.size,
        paying: new Set(store().subscriptions.filter(isPaying).map(sub => sub.accountId)).size,
        waitlist: waitlistCount, clouds: clouds.filter(c => c.status !== "destroyed").length,
        devices: sessions.filter(session => session.kind !== "web").length,
      },
      series: {
        signups: perDay(range, accounts.map(account => ({ day: dayKey(account.createdAt), count: 1 }))),
        waitlist: perDay(range, waitlistDays), active: activeSeries, visitors: series("site_visitors"), views: series("site_view"), apps: series("app_active"),
      },
      funnel: funnel({ since, siteVisitors: series("site_visitors").reduce((a, b) => a + b, 0), accounts, checkouts: store().checkouts, subscriptions: store().subscriptions, sessions,
        workspaces: owned, marked: { onboarded: marked[0]!, paired: marked[1]!, replied: marked[2]!, chosen: marked[3]! } }),
      clouds: [...byState].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
      bots: { workspaces: owned.length, bots: owned.reduce((sum, ws) => sum + (ws.report?.bots?.length ?? 0), 0), turns30d: owned.reduce((sum, ws) => sum + workspaceTurns(ws, sinceDay), 0) },
      platforms: [...sessions.filter(session => session.kind !== "web").reduce((map, session) => map.set(session.platform ?? "unknown", (map.get(session.platform ?? "unknown") ?? 0) + 1), new Map<string, number>())]
        .map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
      spend: { exposed: false, note: "the managed backend keeps its InstaBox cost book internally; it has no read for this panel yet" },
    };
  }

  function users(url: URL) {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
    const offset = int(url.searchParams.get("offset"), 0, 0, 1_000_000), limit = int(url.searchParams.get("limit"), 50, 1, 200);
    const filter = url.searchParams.get("filter") ?? "all";
    const { accounts, identities, sessions } = directory();
    const clouds = allClouds();
    let rows = accounts.map(account => {
      const devices = sessions.filter(session => session.accountId === account.id && session.kind !== "web");
      return { id: account.id, email: account.email, name: account.name, createdAt: account.createdAt, methods: ["email", ...identities.filter(item => item.accountId === account.id).map(item => item.provider)],
        plan: planOf(account.id), clouds: clouds.filter(c => c.accountId === account.id && c.status !== "destroyed").length, devices: devices.length,
        platforms: [...new Set(devices.map(device => device.platform ?? "unknown"))], lastSeenAt: lastSeen(account.id, sessions), optOut: analytics.optedOut(account.id) };
    });
    if (q) rows = rows.filter(row => row.email.includes(q) || (row.name ?? "").toLowerCase().includes(q) || row.id.toLowerCase() === q);
    if (filter === "paying") rows = rows.filter(row => row.plan !== null);
    else if (filter === "cloud") rows = rows.filter(row => row.clouds > 0);
    else if (filter === "app") rows = rows.filter(row => row.devices > 0);
    else if (filter !== "all") throw new AdminError(400, "invalid_request", "Invalid request.");
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return { total: rows.length, offset, limit, users: rows.slice(offset, offset + limit) };
  }

  async function user(id: string) {
    const { accounts, identities, sessions } = directory();
    const account = accounts.find(item => item.id === id);
    if (!account) throw new AdminError(404, "not_found", "Not found.");
    const emails = emailMap(), billingState = store();
    const workspaces = options.workspaces().filter(ws => ws.ownerAccountId === id);
    const sinceDay = dayKey(now() - 29 * DAY);
    const events = await analytics.sink.events({ accountId: id, limit: 200 });
    const derived: Array<Pick<StoredEvent, "name" | "at" | "props">> = [
      { name: "account_created", at: account.createdAt, props: {} },
      ...billingState.checkouts.filter(c => c.accountId === id).map(c => ({ name: "checkout_started", at: c.createdAt, props: { status: c.status, cloud: choseCloud(c), amountCents: c.amountCents, source: c.source ?? "unknown" } })),
      ...billingState.subscriptions.filter(s => s.accountId === id).map(s => ({ name: wasPaid(s) ? "subscription_paid" : "subscription_pending", at: s.createdAt, props: { status: s.status, amountCents: s.totalCents } })),
      ...billingState.invoices.filter(i => i.accountId === id).map(i => ({ name: "payment", at: i.createdAt, props: { status: i.status, amountCents: i.amountCents } })),
    ];
    const timeline = [...events.map(({ name, at, props }) => ({ name, at, props, source: "event" as const })), ...derived.map(item => ({ ...item, source: "record" as const }))]
      .sort((a, b) => b.at - a.at).slice(0, 250);
    return {
      account: { id: account.id, email: account.email, name: account.name, createdAt: account.createdAt, lastSeenAt: lastSeen(id, sessions), optOut: analytics.optedOut(id) },
      methods: ["email", ...identities.filter(item => item.accountId === id).map(item => item.provider)],
      plan: planOf(id),
      subscriptions: subsOf(id).map(sub => ({ id: sub.id, plan: bundleLabel(sub.bundle), status: sub.status, totalCents: sub.totalCents, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, createdAt: sub.createdAt })),
      payments: billingState.invoices.filter(i => i.accountId === id).map(({ id: invoiceId, amountCents, currency, status, createdAt }) => ({ id: invoiceId, amountCents, currency, status, createdAt })),
      devices: sessions.filter(session => session.accountId === id).sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .map(({ id: sessionId, kind, name, platform, appVersion, createdAt, lastSeenAt }) => ({ id: sessionId, kind, name, platform, appVersion, createdAt, lastSeenAt })),
      clouds: billing.clouds.list(id, true).map(c => cloudRow(c, emails)),
      workspaces: workspaces.map(ws => ({ id: ws.id, name: ws.name, kind: ws.kind, version: ws.version, connectedAt: ws.connectedAt, lastReportAt: ws.lastReportAt,
        bots: ws.report?.bots?.length ?? 0, turns30d: workspaceTurns(ws, sinceDay), computers: ws.report?.computers?.computers.length ?? 0 })),
      timeline,
    };
  }

  function clouds(url: URL) {
    const status = url.searchParams.get("status") ?? "live";
    const emails = emailMap();
    let rows = allClouds().map(c => cloudRow(c, emails));
    if (status === "live") rows = rows.filter(row => row.status !== "destroyed" && row.status !== "checkout");
    else if (status !== "all") rows = rows.filter(row => row.status === status);
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return { clouds: rows, now: now() };
  }

  async function cloudAction(owner: { id: string }, id: string, action: string, input: Record<string, unknown>) {
    const cloud = billing.clouds.get(id);
    if (!cloud) throw new AdminError(404, "not_found", "Not found.");
    const row = cloudRow(cloud, emailMap());
    if (!(action in row.actions) || !row.actions[action as keyof typeof row.actions]) throw new AdminError(409, "not_available", `This cloud can't ${action} in its current state.`);
    if (input.confirm !== cloud.id && input.confirm !== cloud.name) throw new AdminError(400, "confirm_required", "Type the cloud's name to confirm.");
    try {
      if (action === "pause") await billing.clouds.power(cloud.accountId, cloud.id, "off");
      else if (action === "resume") { if (cloud.suspended !== null) await billing.clouds.resume(cloud.id); else await billing.clouds.power(cloud.accountId, cloud.id, "on"); }
      else {
        const reason = typeof input.reason === "string" && /^[a-z_]{3,40}$/.test(input.reason) ? input.reason : "admin_panel";
        billing.clouds.managed!.operatorDelete(cloud, reason);
        void billing.clouds.reconcile().catch(() => {});
      }
    } catch (error) {
      await audit(owner.id, `cloud.${action}`, cloud.id, { ok: false, code: (error as { code?: string }).code ?? "failed" });
      const status = (error as { status?: number }).status;
      throw new AdminError(status && status < 500 ? status : 502, (error as { code?: string }).code ?? "failed", "The cloud refused that action. Check its state and try again.");
    }
    await audit(owner.id, `cloud.${action}`, cloud.id, { ok: true, from: row.status });
    return { cloud: cloudRow(cloud, emailMap()) };
  }

  async function events(url: URL) {
    const name = url.searchParams.get("name") || undefined, accountId = url.searchParams.get("account") || undefined;
    if (name !== undefined && !isEventName(name)) throw new AdminError(400, "invalid_request", "Unknown event.");
    if (accountId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(accountId)) throw new AdminError(400, "invalid_request", "Invalid request.");
    const days = int(url.searchParams.get("days"), 7, 1, 400), limit = int(url.searchParams.get("limit"), 100, 1, 500);
    const before = url.searchParams.has("before") ? int(url.searchParams.get("before"), 0, 0, Number.MAX_SAFE_INTEGER) : undefined;
    const time = now(), since = time - days * DAY;
    const [list, counts] = await Promise.all([analytics.sink.events({ name, accountId, since, before, limit: limit + 1 }), analytics.sink.counts(since, time + 1)]);
    const emails = emailMap();
    return { names: EVENT_NAMES, counts, events: list.slice(0, limit).map(event => ({ ...event, email: event.accountId ? emails.get(event.accountId) ?? null : null })),
      next: list.length > limit ? list[limit - 1]!.at : null };
  }

  async function health() {
    const time = now(), backup = newestBackup(options.service.backupDir);
    const [sink, checks] = await Promise.all([analytics.sink.health(), Promise.all(targets.map(target => probe(target, options.fetch)))]);
    const database = options.service.database();
    return {
      now: time,
      service: { version: options.service.version, environment: options.service.environment, startedAt: options.service.startedAt, uptimeSec: Math.round((time - options.service.startedAt) / 1000),
        node: process.version, rssMb: Math.round(process.memoryUsage().rss / 1_048_576) },
      database: database ?? { ok: true, detail: "json files (development)" },
      analytics: { ...sink, written: analytics.stats.written, failed: analytics.stats.failed, dropped: analytics.stats.dropped, lastFailureAt: analytics.stats.lastFailureAt },
      backup: options.service.backupDir ? { configured: true, at: backup?.at ?? null, ageHours: backup ? Math.round((time - backup.at) / 360_000) / 10 : null, ok: !!backup && time - backup.at < 30 * 3_600_000 } : { configured: false, at: null, ageHours: null, ok: null },
      errors: { ...options.errors.counts(), spooled: spoolCount(join(options.service.dataDir, "error-spool")) },
      checks,
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname, method = req.method ?? "GET";
    if (path !== "/v1/admin" && !path.startsWith("/v1/admin/")) return false;
    const mutation = method !== "GET" && method !== "HEAD";
    const owner = gate(req, mutation);
    const route = path.slice("/v1/admin".length) || "/";
    const send = (data: unknown) => { options.json(res, 200, data); return true; };
    if (method === "GET") {
      if (route === "/me") return send({ admin: true, email: owner.email, environment: options.service.environment, version: options.service.version });
      if (route === "/overview") return send(await overview(int(url.searchParams.get("days"), 30, 7, 90)));
      if (route === "/users") return send(users(url));
      const userMatch = /^\/users\/([A-Za-z0-9_-]{1,80})$/.exec(route);
      if (userMatch) {
        const answer = await user(userMatch[1]!);
        await audit(owner.id, "user.view", userMatch[1]!);
        return send(answer);
      }
      if (route === "/clouds") return send(clouds(url));
      const usage = /^\/clouds\/(c[0-9a-f]{24})\/usage$/.exec(route);
      if (usage) {
        const cloud = billing.clouds.get(usage[1]!);
        if (!cloud) throw new AdminError(404, "not_found", "Not found.");
        const managed = billing.clouds.managed;
        const measured = cloud.backend && managed?.usage ? await managed.usage(cloud).catch(() => null) : null;
        return send({ usage: measured, exposed: !!(cloud.backend && managed?.usage) });
      }
      if (route === "/waitlist") {
        if (!options.waitlist) return send({ configured: false, total: 0, entries: [], brevo: { state: "not_configured", listCount: null, waitlistCount: null, checkedAt: null } });
        const q = (url.searchParams.get("q") ?? "").slice(0, 100);
        const offset = int(url.searchParams.get("offset"), 0, 0, 10_000_000), limit = int(url.searchParams.get("limit"), 50, 1, 200);
        const [page, count] = await Promise.all([options.waitlist.list({ search: q, limit, offset }), options.waitlist.count()]);
        const days = dayRange(now(), 30);
        const byDay = await options.waitlist.byDay(Date.parse(`${days[0]}T00:00:00Z`));
        return send({ configured: true, count, total: page.total, offset, limit, entries: page.entries, days, series: perDay(days, byDay), brevo: await brevo(count) });
      }
      if (route === "/waitlist.csv") {
        if (!options.waitlist) throw new AdminError(404, "not_found", "The waitlist is not connected.");
        const entries = await options.waitlist.all();
        await audit(owner.id, "waitlist.export", null, { rows: entries.length });
        res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="dusk-waitlist-${dayKey(now())}.csv"`, "x-content-type-options": "nosniff" });
        res.end(waitlistCsv(entries));
        return true;
      }
      if (route === "/events") return send(await events(url));
      try {
        if (route === "/web") return send(await deep.web(url));
        if (route === "/funnel") return send(await deep.funnel(url));
        if (route === "/journeys") return send(await deep.journeys(url));
        const person = /^\/journeys\/((?:acct_)?[A-Za-z0-9_-]{8,80})$/.exec(route);
        if (person) {
          const answer = await deep.profile(person[1]!);
          await audit(owner.id, "person.view", person[1]!);
          return send(answer);
        }
        if (route === "/realtime") return send(await deep.realtime(url));
        if (route === "/retention") return send(await deep.retention());
        if (route === "/app") return send(await deep.app(url));
        if (route === "/product") return send(await deep.product(url));
      } catch (error) {
        if (error instanceof AnalyticsRouteError) throw new AdminError(error.status, error.code, error.message);
        throw error;
      }
      if (route === "/health") return send(await health());
      if (route === "/audit") {
        const before = url.searchParams.has("before") ? int(url.searchParams.get("before"), 0, 0, Number.MAX_SAFE_INTEGER) : undefined;
        const emails = emailMap();
        return send({ entries: (await analytics.sink.auditLog(100, before)).map(entry => ({ ...entry, actorEmail: emails.get(entry.actor) ?? null })) });
      }
    }
    if (route === "/notes" && method === "POST") {
      const note = await deep.saveNote(owner.id, options.bodyObject(await options.readBody(req))).catch(rethrow);
      await audit(owner.id, "note.add", note.id);
      return send({ note });
    }
    const noteRoute = /^\/notes\/(note_[A-Za-z0-9_-]{6,20})$/.exec(route);
    if (noteRoute && method === "PATCH") {
      const note = await deep.saveNote(owner.id, options.bodyObject(await options.readBody(req)), noteRoute[1]!).catch(rethrow);
      await audit(owner.id, "note.edit", note.id);
      return send({ note });
    }
    if (noteRoute && method === "DELETE") {
      if (!await deep.deleteNote(noteRoute[1]!)) throw new AdminError(404, "not_found", "Not found.");
      await audit(owner.id, "note.delete", noteRoute[1]!);
      return send({ ok: true });
    }
    if (method === "POST") {
      const action = /^\/clouds\/(c[0-9a-f]{24})\/(pause|resume|delete)$/.exec(route);
      if (action) return send(await cloudAction(owner, action[1]!, action[2]!, options.bodyObject(await options.readBody(req))));
    }
    throw new AdminError(404, "not_found", "Route not found.");
  }
  return { handle, isAdmin: (email: string) => allowed.has(email.toLowerCase()) };
}
