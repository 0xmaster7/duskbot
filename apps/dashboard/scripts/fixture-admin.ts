// made-up people, clouds, events and waitlist entries for the admin panel in the local fixture; nothing here is real
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { createDashboardApp } from "../server/app.ts";
import { memoryWaitlist, type WaitlistEntry } from "../server/admin/waitlist.ts";
import { BILLING_CONFIG } from "../server/billing/plans.ts";

const DAY = 86_400_000;
const PEOPLE = ["mira.okafor", "tomas.lindqvist", "priya.raman", "jules.moreau", "kenji.watanabe", "ana.ferreira", "leo.brandt", "sofia.marin", "ravi.kulkarni", "noor.haddad",
  "elena.petrova", "sam.oduya", "hana.kim", "diego.alvarez", "freya.holm", "omar.siddiqui", "lucia.rossi", "ben.carter"];
const COUNTRIES = ["US", "IN", "DE", "GB", "FR", "BR", "JP", "CA", "NL", "SE"];
const REFERRERS: Array<string | undefined> = [undefined, undefined, "www.google.com", "x.com", "news.ycombinator.com", "chatgpt.com", "www.reddit.com", "perplexity.ai", "someblog.dev"];
const id = (prefix: string) => `${prefix}${randomBytes(16).toString("base64url")}`;
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

export interface SeededAccount { id: string; email: string; name: string; createdAt: number }

/** writes auth.json before the service starts, so the seeded accounts have real sign-up dates */
export function seedAdminAuth(dataDir: string, now: number): SeededAccount[] {
  const accounts = PEOPLE.map((handle, i) => ({ id: id("acct_"), email: `${handle}@example.test`, name: handle.split(".").map(part => part[0]!.toUpperCase() + part.slice(1)).join(" "),
    createdAt: now - Math.round((i * 1.7 + rand() * 2) * DAY) - Math.round(rand() * 20) * 3_600_000 }));
  const identities = accounts.filter((_, i) => i % 3 === 0).map(account => ({ accountId: account.id, provider: "google", subject: id("g_"), email: account.email, label: account.email, addedAt: account.createdAt }));
  const sessions = accounts.flatMap((account, i) => {
    const list = [{ kind: "web", name: "Browser", platform: null, appVersion: null }];
    if (i % 2 === 0) list.push({ kind: "desktop", name: `${account.name.split(" ")[0]}'s ${i % 4 === 0 ? "MacBook Pro" : "PC"}`, platform: i % 4 === 0 ? "darwin" : "win32", appVersion: i % 6 === 0 ? "0.2.14" : "0.2.15" } as never);
    if (i % 5 === 1) list.push({ kind: "mobile", name: "iPhone", platform: "ios", appVersion: "0.2.15" } as never);
    return list.map(device => ({ id: id("ses_"), accountId: account.id, tokenHash: createHash("sha256").update(id("t")).digest("hex"), ...device,
      createdAt: account.createdAt + 3_600_000, lastSeenAt: now - Math.round(rand() * 5 * DAY), expiresAt: now + 60 * DAY }));
  });
  writeFileSync(join(dataDir, "auth.json"), JSON.stringify({ accounts: accounts.map(a => ({ ...a, name: a.name })), identities, sessions }), { mode: 0o600 });
  return accounts;
}

export function seedWaitlist(now: number) {
  const entries: WaitlistEntry[] = [];
  for (let i = 0; i < 64; i++) entries.push({ email: `waiting${String(i + 1).padStart(2, "0")}@example.test`, position: i + 1, createdAt: now - Math.round((64 - i) * 0.6 * DAY + rand() * DAY),
    source: pick(["home", "pricing", "x", "launch", null] as const), ref: rand() < 0.2 ? pick(["friend", "newsletter"]) : null });
  return memoryWaitlist(entries);
}

/** clouds through the real (fake-provider) checkout path, then a month of events */
export async function seedAdminData(app: ReturnType<typeof createDashboardApp>, accounts: SeededAccount[], now: number) {
  const { analytics, billing } = app;
  for (const [i, account] of accounts.slice(0, 6).entries()) {
    const bundle = BILLING_CONFIG.bundles.find(item => item.id === (i % 3 === 2 ? "pro" : "starter"))!;
    const answer = await billing.service.checkout({ id: account.id, email: account.email }, { kind: "cart", cart: billing.service.quote({ ...bundle.cart, interval: "month" }).cart, name: `${account.name.split(" ")[0]}'s cloud` }, { source: pick(["dash_onboarding", "app_card", "dash_home"] as const) });
    if (i === 5) continue;
    const stored = billing.store.state.checkouts.find(item => item.id === answer.checkoutId)!;
    for (const delivery of billing.fake!.complete(stored.providerSessionId!)) billing.service.handleWebhook(delivery.headers, delivery.body);
  }
  for (let n = 0; n < 8; n++) await billing.clouds.reconcile();
  const paused = billing.clouds.list(accounts[1]!.id)[0];
  if (paused) await billing.clouds.power(paused.accountId, paused.id, "off").catch(() => {});

  await seedWeb(app, accounts, now);
  for (const [i, account] of accounts.entries()) {
    await analytics.record("signup", { accountId: account.id, at: account.createdAt, props: { method: i % 3 === 0 ? "google" : "email" } });
    await analytics.record("sign_in", { accountId: account.id, at: account.createdAt + 1000, props: { kind: "web" } });
    for (const [s, step] of ["name", "plan", "app"].entries()) if (i % 7 !== 3 || s === 0) await analytics.record("onboarding_step", { accountId: account.id, at: account.createdAt + (s + 1) * 60_000, props: { step, ...(s ? { ms: Math.round(20_000 + rand() * 90_000) } : {}) } });
    if (rand() < 0.6) await analytics.record("page_action", { accountId: account.id, at: account.createdAt + 130_000, props: { action: "choose", label: "plan", value: pick(["plus", "plus", "pro"]), path: "/welcome" } });
    if (rand() < 0.5) await analytics.record("page_action", { accountId: account.id, at: account.createdAt + 200_000, props: { action: "download", label: "download_dusk_bot", value: pick(["mac", "mac", "windows"]), path: "/welcome" } });
    if (i % 7 !== 3) await analytics.record("onboarding_done", { accountId: account.id, at: account.createdAt + 5 * 60_000 });
    if (i % 2 === 0) await analytics.record("app_paired", { accountId: account.id, at: account.createdAt + 3_600_000, props: { via: "app", platform: i % 4 === 0 ? "darwin" : "win32" } });
    if (i % 3 !== 2 && i < 12) await analytics.record("first_bot_reply", { accountId: account.id, at: account.createdAt + 2 * 3_600_000 });
    for (let t = account.createdAt + DAY; t < now; t += DAY) {
      if (rand() < 0.55) await analytics.record("page_view", { accountId: account.id, at: t, props: { path: pick(["/", "/bots", "/usage", "/cloud", "/billing"]) } });
      if (i % 2 === 0 && rand() < 0.7) await analytics.record("app_active", { accountId: account.id, at: t + 3_600_000, props: { platform: i % 4 === 0 ? "darwin" : "win32", appVersion: "0.2.15" } });
    }
  }
}

const CITIES: Array<[string, string, string, number, number]> = [
  ["US", "California", "San Francisco", 37.8, -122.4], ["US", "New York", "New York", 40.7, -74.0], ["US", "Texas", "Austin", 30.3, -97.7], ["IN", "Karnataka", "Bengaluru", 13.0, 77.6],
  ["IN", "Maharashtra", "Pune", 18.5, 73.9], ["DE", "Berlin", "Berlin", 52.5, 13.4], ["GB", "England", "London", 51.5, -0.1], ["FR", "Ile-de-France", "Paris", 48.9, 2.4],
  ["BR", "Sao Paulo", "Sao Paulo", -23.6, -46.6], ["JP", "Tokyo", "Tokyo", 35.7, 139.7], ["CA", "Ontario", "Toronto", 43.7, -79.4], ["NL", "North Holland", "Amsterdam", 52.4, 4.9],
  ["SE", "Stockholm", "Stockholm", 59.3, 18.1], ["AU", "New South Wales", "Sydney", -33.9, 151.2], ["SG", "Singapore", "Singapore", 1.3, 103.8], ["NG", "Lagos", "Lagos", 6.5, 3.4],
];
const TOUCHES: Array<{ referrer?: string; source: string; channel: string; campaign?: string; ref?: string }> = [
  { source: "direct", channel: "direct" }, { source: "direct", channel: "direct" }, { referrer: "www.google.com", source: "Google", channel: "search" },
  { referrer: "x.com", source: "X", channel: "social", ref: "launch-thread" }, { referrer: "news.ycombinator.com", source: "Hacker News", channel: "social" },
  { referrer: "chatgpt.com", source: "ChatGPT", channel: "ai" }, { referrer: "www.perplexity.ai", source: "Perplexity", channel: "ai" }, { referrer: "claude.ai", source: "Claude", channel: "ai" },
  { referrer: "www.reddit.com", source: "Reddit", channel: "social" }, { source: "newsletter", channel: "email", campaign: "november" }, { referrer: "someblog.dev", source: "someblog.dev", channel: "referral" },
];
const PATHS = ["/", "/pricing", "/download", "/docs", "/about", "/changelog"];
const vid = () => randomBytes(16).toString("base64url");
const LANDING = ["hero", "say", "team", "many", "where", "models", "free", "pricing", "how", "everywhere", "faq", "end"];
const CLICKS = [{ label: "monthly", section: "pricing", value: "m" }, { label: "yearly", section: "pricing", value: "y" }, { label: "see_how_it_works", section: "hero" }, { label: "how_do_i_pay", section: "faq" }];

/** site visits through the tracker's own event shapes, accounts linked to the visitor they came from, app use and two chart notes */
async function seedWeb(app: ReturnType<typeof createDashboardApp>, accounts: SeededAccount[], now: number) {
  const { analytics } = app;
  const visit = async (visitor: string, start: number, opts: { pages?: string[]; goals?: Array<[string, Record<string, string>?]>; touch?: (typeof TOUCHES)[number]; place?: (typeof CITIES)[number] } = {}) => {
    const touch = opts.touch ?? pick(TOUCHES), place = opts.place ?? pick(CITIES), mobile = rand() < 0.32;
    const session = vid(), pages = opts.pages ?? ["/", ...(rand() < 0.55 ? [pick(PATHS.slice(1))] : []), ...(rand() < 0.25 ? [pick(PATHS.slice(1))] : [])];
    const base = { session, host: "preview.dusk.bot", country: place[0], region: place[1], city: place[2], lat: place[3], lon: place[4], device: mobile ? "mobile" as const : "desktop" as const,
      os: mobile ? (rand() < 0.6 ? "ios" as const : "android" as const) : pick(["mac", "windows", "linux"] as const), browser: pick(["chrome", "safari", "firefox", "edge"] as const) };
    let at = start;
    for (const [k, path] of pages.entries()) {
      const pv = vid().slice(0, 8);
      await analytics.record("site_view", { at, visitor, props: { path }, ctx: { ...base, pv, page: path, ...(k === 0 ? { source: touch.source, channel: touch.channel as never, referrer: touch.referrer, ref: touch.ref, utm: touch.campaign ? { campaign: touch.campaign, medium: "email", source: "newsletter" } : undefined } : {}) } });
      const ms = Math.round(4000 + rand() * 90_000);
      await analytics.record("site_leave", { at: at + ms, visitor, props: { path, scroll: Math.round(20 + rand() * 80), ms }, ctx: { ...base, pv, page: path } });
      at += ms + 2000;
    }
    for (const [goal, meta] of opts.goals ?? []) await analytics.record("site_goal", { at, visitor, props: { goal, ...meta }, ctx: { ...base, page: pages.at(-1) } });
    if (pages[0] === "/") {
      const seen = LANDING.slice(0, 2 + Math.floor(rand() * (LANDING.length - 1)));
      for (const section of seen) await analytics.record("site_section", { at: start + 1000, visitor, props: { path: "/", section, ms: Math.round(800 + rand() * 14_000) }, ctx: { ...base, page: "/" } });
      if (rand() < 0.35) await analytics.record("site_goal", { at, visitor, props: { goal: "click", ...pick(CLICKS) }, ctx: { ...base, page: "/" } });
      if (rand() < 0.1) await analytics.record("site_goal", { at, visitor, props: { goal: "form_start", label: "waitlist", section: "end" }, ctx: { ...base, page: "/" } });
      if (rand() < 0.05) await analytics.record("site_goal", { at, visitor, props: { goal: "form_abandon", label: "waitlist", section: "end" }, ctx: { ...base, page: "/" } });
      if (rand() < 0.03) await analytics.record("site_goal", { at, visitor, props: { goal: "rage_click", label: "monthly", section: "pricing" }, ctx: { ...base, page: "/" } });
    }
    return at;
  };
  for (let d = 29; d >= 0; d--) {
    const count = 10 + Math.round(rand() * 14 + (29 - d) * 0.6);
    for (let v = 0; v < count; v++) {
      const goals: Array<[string, Record<string, string>?]> = [];
      if (rand() < 0.08) goals.push(["waitlist_join"]);
      if (rand() < 0.12) goals.push(["download_click", { to: "/download", value: pick(["mac", "mac", "windows", "linux"]) }]);
      await visit(vid(), now - d * DAY - Math.round(rand() * 20 * 3_600_000) - 3_600_000, { goals });
    }
  }
  for (const account of accounts) {
    const visitor = vid(), first = account.createdAt - Math.round(rand() * 3 * DAY) - 600_000;
    await visit(visitor, first, { pages: ["/", "/pricing"], goals: [["cta_click", { to: "/app/signup", from: "/pricing" }]] });
    if (rand() < 0.5) await visit(visitor, account.createdAt - 300_000, { pages: ["/pricing"] });
    await analytics.record("identify", { accountId: account.id, at: account.createdAt + 2000, props: { via: "page" }, ctx: { visitor } });
  }
  for (const [i, account] of accounts.entries()) {
    if (i % 2) continue;
    const install = randomBytes(12).toString("base64url"), platform = i % 4 === 0 ? "darwin" : "win32";
    await analytics.record("identify", { accountId: account.id, at: account.createdAt + 3_600_000, props: { via: "app" }, ctx: { install } });
    for (let t = account.createdAt + 3_600_000; t < now; t += DAY * (0.6 + rand())) {
      const ctx = { install, session: randomBytes(12).toString("base64url"), app: { platform, version: "0.2.15" } };
      await analytics.record("app_open", { accountId: account.id, at: t, props: { kind: "desktop", platform, appVersion: "0.2.15" }, ctx });
      for (const screen of ["/chat/:id", pick(["/bots", "/routines", "/rooms", "/computers", "/settings"])]) await analytics.record("app_screen", { accountId: account.id, at: t + 60_000, props: { screen }, ctx: { ...ctx, page: screen } });
      if (rand() < 0.6) await analytics.record("app_feature", { accountId: account.id, at: t + 120_000, props: { feature: pick(["bot_created", "routine_created", "routine_ran", "file_uploaded", "voice_used", "app_connected", "computer_used"]) }, ctx });
      const sent = 1 + Math.round(rand() * 14);
      await analytics.record("app_messages", { accountId: account.id, at: t + 900_000, props: { sent, replies: sent, latencyMs: Math.round(900 + rand() * 4000) }, ctx });
      if (rand() < 0.08) await analytics.record("app_error", { accountId: account.id, at: t + 1000_000, props: { kind: "window", code: "error" }, ctx });
      if (rand() < 0.3) await analytics.record("app_action", { accountId: account.id, at: t + 200_000, props: { name: "cloud_card_shown", variant: "free" }, ctx });
      if (rand() < 0.12) await analytics.record("app_action", { accountId: account.id, at: t + 210_000, props: { name: "cloud_card_action", action: pick(["start_trial", "not_now", "not_now"]) }, ctx });
      if (rand() < 0.25) await analytics.record("app_action", { accountId: account.id, at: t + 300_000, props: { name: "reply_reaction", emoji: pick(["yes", "yes", "love", "no"]), on: true }, ctx });
      if (rand() < 0.06) await analytics.record("app_feedback", { accountId: account.id, at: t + 400_000, props: { score: pick([5, 5, 4, 4, 3, 2]), moment: pick(["after_replies", "after_routine"]) }, ctx });
      if (rand() < 0.1) await analytics.record("app_feature", { accountId: account.id, at: t + 500_000, props: { feature: "bot_deleted" }, ctx });
      await analytics.record("app_close", { accountId: account.id, at: t + 1_200_000, props: { ms: Math.round(120_000 + rand() * 1_800_000) }, ctx });
      if (rand() < 0.05) await analytics.record("app_pair_failed", { accountId: account.id, at: t + 1100_000, props: { reason: pick(["expired_code", "network"]) }, ctx });
    }
  }
  for (let v = 0; v < 9; v++) await visit(vid(), now - Math.round(rand() * 25 * 60_000), { pages: rand() < 0.5 ? ["/", "/pricing"] : ["/"], goals: rand() < 0.3 ? [["waitlist_join"]] : [] });
  const BOTS: Array<[string, "answers" | "indexing" | "training"]> = [["GPTBot", "training"], ["ChatGPT-User", "answers"], ["ClaudeBot", "training"], ["PerplexityBot", "indexing"], ["OAI-SearchBot", "indexing"], ["Claude-User", "answers"]];
  for (let c = 0; c < 140; c++) { const [bot, kind] = pick(BOTS); await analytics.sink.crawl({ at: now - Math.round(rand() * 29 * DAY), bot, kind, path: pick([...PATHS, "/robots.txt", "/llms.txt", "/docs/getting-started"]), host: "preview.dusk.bot" }); }
  await analytics.sink.saveNote({ id: "note_launchx1", at: now - 12 * DAY, text: "launch thread on x", by: accounts[0]!.id, createdAt: now });
  await analytics.sink.saveNote({ id: "note_pricing2", at: now - 4 * DAY, text: "new pricing page", by: accounts[0]!.id, createdAt: now });
}
