import { randomBytes } from "node:crypto";
import type { createAuth } from "../auth/index.ts";
import type { createBilling } from "../billing/index.ts";
import type { Analytics } from "../analytics/index.ts";
import type { StoredEvent } from "../analytics/sink.ts";
import type { StoredWorkspace } from "../store.ts";
import { DAY, DIMENSIONS, activeDays, breakdown, funnel, identityOf, kpis, online, retention, series, visitsOf, type Dimension, type Filters, type People, type Visit } from "../analytics/web.ts";
import { choseCloud, wasPaid, workspaceTurns } from "./metrics.ts";

export class AnalyticsRouteError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const bad = (message = "Invalid request.") => new AnalyticsRouteError(400, "invalid_request", message);

/** a window from the caller: from and to in ms (the page sends its own local midnight), at most 400 days */
export function windowOf(url: URL, now: number): { from: number; to: number } {
  const to = url.searchParams.has("to") ? Number(url.searchParams.get("to")) : now;
  const from = url.searchParams.has("from") ? Number(url.searchParams.get("from")) : to - 30 * DAY;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to || to - from > 400 * DAY || to > now + DAY) throw bad("Invalid date range.");
  return { from, to };
}
export function filtersOf(url: URL): Filters {
  const out: Filters = {};
  for (const dim of DIMENSIONS) {
    const value = url.searchParams.get(`f.${dim}`);
    if (value !== null) { if (value.length > 200) throw bad(); out[dim] = value; }
  }
  return out;
}

type Auth = ReturnType<typeof createAuth>;
type Billing = ReturnType<typeof createBilling>;
export interface AnalyticsRoutesOptions { auth: Auth; billing: Billing; analytics: Analytics; workspaces: () => StoredWorkspace[]; now: () => number; actor: (id: string) => string | null }

export function createAnalyticsRoutes(options: AnalyticsRoutesOptions) {
  const { auth, billing, analytics, now } = options;
  const sink = analytics.sink;

  function people(): People & { cloudChosen: Map<string, number>; paired: Map<string, number>; replied: Map<string, number> } {
    const { accounts, sessions } = auth.directory();
    const state = billing.store.state;
    const first = (map: Map<string, number>, id: string, at: number) => { if (!map.has(id) || map.get(id)! > at) map.set(id, at); };
    const signups = new Map(accounts.map(account => [account.id, account.createdAt]));
    const paid = new Map<string, number>(), cloudChosen = new Map<string, number>(), paired = new Map<string, number>(), replied = new Map<string, number>();
    for (const sub of state.subscriptions) if (wasPaid(sub)) first(paid, sub.accountId, sub.createdAt);
    for (const invoice of state.invoices) if (invoice.status === "paid") first(paid, invoice.accountId, invoice.createdAt);
    for (const checkout of state.checkouts) if (choseCloud(checkout)) first(cloudChosen, checkout.accountId, checkout.createdAt);
    for (const session of sessions) if (session.kind !== "web") first(paired, session.accountId, session.createdAt);
    for (const ws of options.workspaces()) if (ws.ownerAccountId && workspaceTurns(ws) > 0) first(replied, ws.ownerAccountId, ws.lastReportAt ?? ws.connectedAt);
    return { signups, paid, cloudChosen, paired, replied };
  }
  async function load(from: number) {
    const [events, identifies] = await Promise.all([sink.scan(from, now() + 60_000), sink.scan(0, now() + 60_000, ["identify"])]);
    const merged = events.some(event => event.name === "identify") ? events : [...events, ...identifies];
    const identity = identityOf(identifies);
    const p = people();
    for (const event of events) {
      if (!event.accountId) continue;
      if (event.name === "app_paired" && (!p.paired.has(event.accountId) || p.paired.get(event.accountId)! > event.at)) p.paired.set(event.accountId, event.at);
      if (event.name === "first_bot_reply" && (!p.replied.has(event.accountId) || p.replied.get(event.accountId)! > event.at)) p.replied.set(event.accountId, event.at);
      if (event.name === "plan_chosen" && (!p.cloudChosen.has(event.accountId) || p.cloudChosen.get(event.accountId)! > event.at)) p.cloudChosen.set(event.accountId, event.at);
    }
    return { events: merged, identity, people: p, visits: visitsOf(events) };
  }

  async function web(url: URL) {
    const { from, to } = windowOf(url, now()), span = to - from, filters = filtersOf(url);
    const { events, identity, people: p, visits } = await load(from - span);
    const current = kpis(visits, identity, p, from, to, filters), previous = kpis(visits, identity, p, from - span, from, filters);
    const cards = Object.fromEntries(DIMENSIONS.map(dim => [dim, breakdown(visits, identity, p, dim, from, to, filters)]));
    const live = online(events, now());
    const crawls = await sink.crawls(from, to);
    const count = (values: string[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())]
      .map(([key, requests]) => ({ key, visitors: requests, signups: 0, paid: 0 })).sort((a, b) => b.visitors - a.visitors).slice(0, 50);
    return { from, to, now: now(), filters, current, previous, online: live, series: series(visits, p, from, to, filters, identity), cards, notes: await sink.notes(from - span, to),
      tracked: visits.length > 0, crawlers: { total: crawls.length, bot: count(crawls.map(c => c.bot)), page: count(crawls.map(c => c.path)), kind: count(crawls.map(c => c.kind)) } };
  }

  async function funnelRoute(url: URL) {
    const { from, to } = windowOf(url, now());
    const mode = url.searchParams.get("mode") === "signups" ? "signups" : "visitors";
    const { events, identity, people: p, visits } = await load(from);
    return { from, to, ...funnel({ from, to, now: now(), mode, visits, identity, events, people: p, cloudChosen: p.cloudChosen, paired: p.paired, replied: p.replied }) };
  }

  function personOf(visits: Visit[]) {
    const first = visits[0]!, last = visits.at(-1)!;
    return { visits: visits.length, pageviews: visits.reduce((sum, visit) => sum + visit.pages.length, 0), firstSeen: first.start, lastSeen: last.end,
      source: first.source, channel: first.channel, campaign: first.campaign, device: first.device, os: first.os, browser: first.browser, country: first.country, city: first.city,
      lastPage: last.exit };
  }

  async function journeys(url: URL) {
    const { from, to } = windowOf(url, now());
    const only = url.searchParams.get("only") ?? "all";
    if (!["all", "signups", "customers"].includes(only)) throw bad();
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
    const { identity, people: p, visits } = await load(from - 90 * DAY);
    const emails = new Map(auth.directory().accounts.map(account => [account.id, account]));
    const groups = new Map<string, Visit[]>();
    for (const visit of visits) {
      const key = identity.accountOf.get(visit.visitor) ?? visit.visitor;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(visit);
    }
    for (const [account, at] of p.signups) if (at >= from && at < to && !groups.has(account)) groups.set(account, []);
    const rows = [];
    for (const [key, list] of groups) {
      const account = emails.get(key) ?? null;
      const recent = list.some(visit => visit.end >= from && visit.start < to) || (account && account.createdAt >= from && account.createdAt < to);
      if (!recent) continue;
      const summary = list.length ? personOf(list) : null;
      const signedUp = account ? account.createdAt : null, paidAt = account ? p.paid.get(account.id) ?? null : null;
      const firstSeen = summary?.firstSeen ?? signedUp;
      rows.push({ id: key, seed: list[0]?.visitor ?? key, account: account ? { id: account.id, email: account.email, name: account.name } : null, customer: paidAt !== null,
        signedUpAt: signedUp, paidAt, firstSeen, lastSeen: summary?.lastSeen ?? signedUp, timeToSignupMs: signedUp !== null && firstSeen !== null ? Math.max(0, signedUp - firstSeen) : null,
        visits: summary?.visits ?? 0, pageviews: summary?.pageviews ?? 0, source: summary?.source ?? "unknown", channel: summary?.channel ?? "unknown", campaign: summary?.campaign ?? null,
        device: summary?.device ?? null, os: summary?.os ?? null, browser: summary?.browser ?? null, country: summary?.country ?? null, city: summary?.city ?? null, lastPage: summary?.lastPage ?? null });
    }
    let list = rows;
    if (only === "signups") list = list.filter(row => row.account);
    if (only === "customers") list = list.filter(row => row.customer);
    if (q) list = list.filter(row => row.id.toLowerCase().includes(q) || row.account?.email.includes(q) || (row.account?.name ?? "").toLowerCase().includes(q) || row.source.toLowerCase().includes(q));
    list.sort((a, b) => Number(b.customer) - Number(a.customer) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    return { from, to, total: list.length, people: list.slice(0, 200) };
  }

  async function profile(id: string) {
    const idents = await sink.scan(0, now() + 60_000, ["identify"]);
    const identity = identityOf(idents);
    const account = id.startsWith("acct_") ? id : identity.accountOf.get(id) ?? null;
    const visitors = new Set(account ? identity.visitorsOf.get(account) ?? [] : [id]);
    if (!account) visitors.add(id);
    const installs = account ? identity.installsOf.get(account) ?? new Set<string>() : new Set<string>();
    const all = await sink.scan(now() - 400 * DAY, now() + 60_000);
    const mine = all.filter(event => (account && event.accountId === account) || (event.ctx?.visitor && visitors.has(event.ctx.visitor)) || (event.ctx?.install && installs.has(event.ctx.install)));
    if (!mine.length && !account) throw new AnalyticsRouteError(404, "not_found", "Not found.");
    const owner = account ? auth.directory().accounts.find(item => item.id === account) ?? null : null;
    const p = people();
    const visits = visitsOf(mine);
    const surface = (event: StoredEvent) => event.name.startsWith("site_") ? "site" : event.name.startsWith("app_") ? "app" : event.name === "page_view" || event.name.startsWith("onboarding") || event.name === "plan_chosen" || event.name === "download_click" ? "account" : "server";
    const timeline = mine.filter(event => event.name !== "site_leave").slice(-400).reverse().map(event => ({ at: event.at, name: event.name, surface: surface(event), props: event.props,
      page: event.ctx?.page ?? null, source: event.ctx?.source ?? null, country: event.ctx?.country ?? null, device: event.ctx?.device ?? null, app: event.ctx?.app ?? null }));
    return {
      id, seed: [...visitors][0] ?? id, account: owner ? { id: owner.id, email: owner.email, name: owner.name, createdAt: owner.createdAt } : null,
      customer: !!(account && p.paid.has(account)), paidAt: account ? p.paid.get(account) ?? null : null, visitors: visitors.size, installs: installs.size,
      summary: visits.length ? personOf(visits) : null, timeline,
    };
  }

  async function realtime(url: URL) {
    const minutes = Number(url.searchParams.get("minutes") ?? "30");
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) throw bad();
    const time = now(), since = time - minutes * 60_000;
    const [events, idents] = await Promise.all([sink.scan(since, time + 60_000), sink.scan(0, time + 60_000, ["identify"])]);
    const identity = identityOf(idents);
    const p = people();
    const accounts = new Map(auth.directory().accounts.map(account => [account.id, account]));
    const NOTABLE = new Set(["site_view", "site_goal", "signup", "app_paired", "first_bot_reply", "checkout_paid", "app_open"]);
    const geo = new Map<string, { country?: string; city?: string; lat?: number; lon?: number }>();
    for (const event of events) if (event.ctx?.visitor && (event.ctx.country || event.ctx.lat !== undefined)) geo.set(event.ctx.visitor, { country: event.ctx.country, city: event.ctx.city, lat: event.ctx.lat, lon: event.ctx.lon });
    const seedOf = (event: StoredEvent) => event.ctx?.visitor ?? (event.accountId ? [...(identity.visitorsOf.get(event.accountId) ?? [])][0] ?? event.accountId : event.ctx?.install ?? event.id);
    const feed = events.filter(event => NOTABLE.has(event.name)).slice(-300).reverse().map(event => {
      const account = event.accountId ?? (event.ctx?.visitor ? identity.accountOf.get(event.ctx.visitor) ?? null : null);
      const where = event.ctx?.visitor ? geo.get(event.ctx.visitor) : undefined;
      return { id: event.id, at: event.at, name: event.name, seed: seedOf(event), email: account ? accounts.get(account)?.email ?? null : null, customer: !!(account && p.paid.has(account)),
        page: event.ctx?.page ?? (typeof event.props.path === "string" ? event.props.path : null), goal: typeof event.props.goal === "string" ? event.props.goal : null,
        source: event.ctx?.source ?? null, country: where?.country ?? event.ctx?.country ?? null, city: where?.city ?? event.ctx?.city ?? null, lat: where?.lat ?? event.ctx?.lat ?? null, lon: where?.lon ?? event.ctx?.lon ?? null };
    });
    const latest = new Map<string, (typeof feed)[number]>();
    for (const item of feed) if (item.at >= time - 5 * 60_000 && (item.name === "site_view" || item.name === "site_goal") && !latest.has(item.seed)) latest.set(item.seed, item);
    return { now: time, minutes, online: online(events, time), here: [...latest.values()], feed };
  }

  async function retentionRoute() {
    const time = now();
    const events = await sink.scan(time - 120 * DAY, time + 60_000);
    const p = people();
    const days = activeDays(events);
    const cohorts = retention(p.signups, days, time);
    const accounts = new Map(auth.directory().accounts.map(account => [account.id, account]));
    const since = time - 30 * DAY;
    const power = new Map<string, { days: Set<number>; opens: number; sent: number; replies: number; features: number; lastAt: number }>();
    for (const event of events) {
      if (!event.accountId || event.at < since) continue;
      const row = power.get(event.accountId) ?? power.set(event.accountId, { days: new Set(), opens: 0, sent: 0, replies: 0, features: 0, lastAt: 0 }).get(event.accountId)!;
      if (days.get(event.accountId)?.has(Math.floor(event.at / DAY))) row.days.add(Math.floor(event.at / DAY));
      if (event.name === "app_open") row.opens++;
      if (event.name === "app_messages") { row.sent += Number(event.props.sent) || 0; row.replies += Number(event.props.replies) || 0; }
      if (event.name === "app_feature") row.features++;
      row.lastAt = Math.max(row.lastAt, event.at);
    }
    const users = [...power].filter(([id]) => accounts.has(id)).map(([id, row]) => ({ id, email: accounts.get(id)!.email, name: accounts.get(id)!.name, activeDays: row.days.size, opens: row.opens,
      sent: row.sent, replies: row.replies, features: row.features, lastAt: row.lastAt, customer: p.paid.has(id) }))
      .sort((a, b) => b.activeDays - a.activeDays || b.sent - a.sent).slice(0, 25);
    return { now: time, cohorts, power: users };
  }

  async function app(url: URL) {
    const { from, to } = windowOf(url, now());
    const events = (await sink.scan(from, to)).filter(event => event.name.startsWith("app_"));
    const top = (values: string[], limit = 12) => {
      const counts = new Map<string, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, limit);
    };
    const days = Math.ceil((to - from) / DAY), perDay = Array.from({ length: days }, () => new Set<string>()), opens = Array.from({ length: days }, () => 0);
    const installs = new Set<string>(), identified = new Set<string>();
    let sent = 0, replies = 0;
    const latencies: Array<[number, number]> = [];
    for (const event of events) {
      const who = event.accountId ?? event.ctx?.install;
      const index = Math.floor((event.at - from) / DAY);
      if (who && perDay[index]) perDay[index]!.add(who);
      if (event.name === "app_open" && opens[index] !== undefined) opens[index]! += 1;
      if (event.ctx?.install) { installs.add(event.ctx.install); if (event.accountId) identified.add(event.ctx.install); }
      if (event.name === "app_messages") {
        sent += Number(event.props.sent) || 0; replies += Number(event.props.replies) || 0;
        if (Number(event.props.latencyMs) > 0 && Number(event.props.replies) > 0) latencies.push([Number(event.props.latencyMs), Number(event.props.replies)]);
      }
    }
    latencies.sort((a, b) => a[0] - b[0]);
    const weight = latencies.reduce((sum, [, n]) => sum + n, 0);
    let acc = 0, latency: number | null = null;
    for (const [ms, n] of latencies) { acc += n; if (acc >= weight / 2) { latency = ms; break; } }
    const of = (name: string, prop: string) => events.filter(event => event.name === name).map(event => String(event.props[prop] ?? "unknown"));
    return {
      from, to, days: Array.from({ length: days }, (_, i) => from + i * DAY), active: perDay.map(set => set.size), opens,
      installs: installs.size, identified: identified.size, sent, replies, latencyMs: latency,
      screens: top(of("app_screen", "screen")), features: top(of("app_feature", "feature")),
      errors: top(events.filter(event => event.name === "app_error").map(event => `${event.props.kind ?? "unknown"}: ${event.props.code ?? "unknown"}`)),
      pairFailures: top(of("app_pair_failed", "reason")),
      platforms: top(events.filter(event => event.name === "app_open").map(event => event.ctx?.app?.platform ?? "unknown")),
      versions: top(events.filter(event => event.name === "app_open").map(event => `${event.ctx?.app?.platform ?? "?"} ${event.ctx?.app?.version ?? "?"}`)),
    };
  }

  async function saveNote(actor: string, input: Record<string, unknown>, id?: string) {
    const text = typeof input.text === "string" ? input.text.replace(/[\u0000-\u001f]/g, " ").trim() : "";
    const at = Number(input.at);
    if (!text || text.length > 140 || !Number.isSafeInteger(at) || at < 0 || at > now() + 365 * DAY) throw bad("A note needs a date and 1 to 140 characters.");
    const existing = id ? (await sink.notes(0, Number.MAX_SAFE_INTEGER)).find(note => note.id === id) : null;
    if (id && !existing) throw new AnalyticsRouteError(404, "not_found", "Not found.");
    const note = { id: id ?? `note_${randomBytes(9).toString("base64url")}`, at, text, by: existing?.by ?? actor, createdAt: existing?.createdAt ?? now() };
    await sink.saveNote(note);
    return note;
  }

  return { web, funnel: funnelRoute, journeys, profile, realtime, retention: retentionRoute, app, saveNote, deleteNote: (id: string) => sink.deleteNote(id), isDimension: (value: string): value is Dimension => (DIMENSIONS as readonly string[]).includes(value) };
}
