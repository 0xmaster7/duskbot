import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import { createAnalytics } from "./index.ts";
import { memorySink, mongoSink } from "./sink.ts";
import { channelOf, deviceOf, requestContext } from "./context.ts";
import { cleanProps, routeOf } from "./events.ts";
import { funnel, dayRange, perDay } from "../admin/metrics.ts";
import { brevoChecker, csvField } from "../admin/waitlist.ts";
import { healthTargets } from "../admin/health.ts";

const DAY = 86_400_000;
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const fakeReq = (headers: Record<string, string>, url = "/", method = "GET") => ({ method, url, headers, socket: { remoteAddress: "203.0.113.9" } }) as unknown as IncomingMessage;
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

describe("analytics", () => {
  let dataDir: string, time: number;
  let sink: ReturnType<typeof memorySink>;
  let analytics: ReturnType<typeof createAnalytics>;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "omb-analytics-test-"));
    time = Date.parse("2026-11-12T10:00:00Z");
    sink = memorySink(() => time);
    analytics = createAnalytics({ sink, dataDir, now: () => time, trustProxy: true });
  });
  afterEach(() => { analytics.close(); rmSync(dataDir, { recursive: true, force: true }); });

  it("counts site page views, unique visitors per day, and skips bots, assets, prefetches and declined tracking", async () => {
    const page = { accept: "text/html", "user-agent": SAFARI, "cf-ipcountry": "DE", referer: "https://www.google.com/search?q=dusk" };
    analytics.siteView(fakeReq(page, "/pricing?utm_source=Newsletter&utm_medium=email"), "https://dusk.bot");
    analytics.siteView(fakeReq(page, "/"), "https://dusk.bot");
    analytics.siteView(fakeReq({ ...page, "user-agent": "Googlebot/2.1" }, "/"), "https://dusk.bot");
    analytics.siteView(fakeReq(page, "/logo.png"), "https://dusk.bot");
    analytics.siteView(fakeReq({ ...page, "sec-fetch-dest": "image" }, "/"), "https://dusk.bot");
    analytics.siteView(fakeReq({ ...page, "sec-gpc": "1" }, "/"), "https://dusk.bot");
    analytics.siteView(fakeReq({ ...page, accept: "application/json" }, "/"), "https://dusk.bot");
    analytics.siteView(fakeReq(page, "/", "POST"), "https://dusk.bot");
    await settle();
    expect(sink.all.map(event => event.props.path)).toEqual(["/pricing", "/"]);
    expect(sink.all[0]!.ctx).toMatchObject({ country: "DE", device: "desktop", os: "mac", browser: "safari", referrer: "www.google.com", channel: "email", utm: { source: "newsletter", medium: "email" }, page: "/pricing" });
    expect(sink.all[0]!.ctx!.visitor).toBe(sink.all[1]!.ctx!.visitor);
    expect(JSON.stringify(sink.all)).not.toContain("203.0.113.9");
    const day = new Date(time).toISOString().slice(0, 10);
    expect(sink.daySums.get(`${day}|site_view`)).toBe(2);
    expect(sink.daySums.get(`${day}|site_visitors`)).toBe(1);
    time += DAY;
    analytics.siteView(fakeReq(page, "/"), "https://dusk.bot");
    await settle();
    expect(sink.all.at(-1)!.ctx!.visitor).not.toBe(sink.all[0]!.ctx!.visitor);
  });

  it("reads the country only behind a trusted proxy", () => {
    const req = fakeReq({ "user-agent": IPHONE, "cf-ipcountry": "IN" });
    expect(requestContext(req, { publicOrigin: "https://dusk.bot", trustProxy: false })).toEqual({ device: "mobile", os: "ios", browser: "safari", channel: "direct" });
    expect(requestContext(req, { publicOrigin: "https://dusk.bot", trustProxy: true }).country).toBe("IN");
  });

  it("names channels, with AI assistants apart from search", () => {
    expect(channelOf("chatgpt.com", undefined)).toBe("ai");
    expect(channelOf("www.perplexity.ai", undefined)).toBe("ai");
    expect(channelOf("www.google.com", undefined)).toBe("search");
    expect(channelOf("x.com", undefined)).toBe("social");
    expect(channelOf("someblog.dev", undefined)).toBe("referral");
    expect(channelOf(undefined, undefined)).toBe("direct");
    expect(channelOf(undefined, { source: "launch", campaign: "nov" })).toBe("campaign");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131 Mobile")).toEqual({ device: "mobile", os: "android", browser: "chrome" });
  });

  it("counts an app device active once a day, and the first bot reply once ever", async () => {
    const session = { id: "ses_1", accountId: "acct_1", platform: "darwin", appVersion: "0.2.0" };
    for (let n = 0; n < 5; n++) analytics.appActive(session);
    analytics.botReplied("acct_1"); analytics.botReplied("acct_1");
    await settle();
    expect(sink.all.map(event => event.name)).toEqual(["app_active", "first_bot_reply"]);
    expect(sink.all[0]).toMatchObject({ props: { platform: "darwin", appVersion: "0.2.0" }, ctx: { session: "ses_1", app: { platform: "darwin", version: "0.2.0" } } });
    time += DAY;
    analytics.appActive(session);
    const restarted = createAnalytics({ sink, dataDir, now: () => time });
    restarted.botReplied("acct_1");
    await settle();
    restarted.close();
    expect(sink.all.map(event => event.name)).toEqual(["app_active", "first_bot_reply", "app_active"]);
  });

  it("keeps raw events 400 days and the daily counts forever", async () => {
    await analytics.record("onboarding_done", { accountId: "acct_1" });
    time += 401 * DAY;
    await analytics.record("onboarding_done", { accountId: "acct_2" });
    expect(sink.all.map(event => event.accountId)).toEqual(["acct_2"]);
    expect([...sink.daySums.values()].reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("keeps only known props and folds ids out of routes", () => {
    expect(cleanProps("sign_in", { kind: "desktop", platform: "darwin", appVersion: "1.2.3", email: "a@b.c" })).toEqual({ kind: "desktop", platform: "darwin", appVersion: "1.2.3" });
    expect(cleanProps("cloud_state", { cloudId: "nope" })).toEqual({});
    expect(routeOf("/Workspaces/ws_8f3k2m1n0p9q/?tab=1")).toBe("/workspaces/:id");
    expect(routeOf("/billing")).toBe("/billing");
    expect(routeOf("/invoices/12345")).toBe("/invoices/:id");
  });
});

describe("admin metrics", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  it("builds a nested funnel and keeps each step's own total", () => {
    const accounts = ["a", "b", "c", "d"].map((id, i) => ({ id, createdAt: now - i * DAY }));
    const steps = funnel({ since: now - 10 * DAY, siteVisitors: 40, accounts: [...accounts, { id: "old", createdAt: now - 90 * DAY }],
      checkouts: [{ accountId: "a", kind: "cart", cart: { interval: "month", license: { kind: "none" }, desktop: { kind: "shared_s" } } }, { accountId: "b", kind: "credits", cart: null }],
      subscriptions: [{ accountId: "a", status: "active", currentPeriodStart: now }, { accountId: "old", status: "active", currentPeriodStart: now }],
      sessions: [{ accountId: "a", kind: "desktop" }, { accountId: "c", kind: "mobile" }, { accountId: "d", kind: "web" }],
      workspaces: [{ ownerAccountId: "c", report: { at: now, workspace: { name: "x", kind: "mac", version: "1", platform: "darwin" }, activity: { from: "", to: "", timeZone: "UTC", days: [{ date: "2026-11-12", turns: 3, tokens: 1, costUsd: 0 }], byBot: [], byModel: [], totals: { turns: 3, tokens: 1, costUsd: 0 } } } }],
      marked: { onboarded: new Set(["d"]), paired: new Set(), replied: new Set(), chosen: new Set() } });
    expect(steps.map(step => [step.id, step.count, step.total])).toEqual([["site", 40, 40], ["signup", 4, 4], ["onboarded", 3, 3], ["cloud", 1, 1], ["paid", 1, 1], ["paired", 1, 2], ["replied", 0, 1]]);
  });
  it("lays counts on a fixed day range", () => {
    const days = dayRange(now, 3);
    expect(days).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(perDay(days, [{ day: "2026-11-12", count: 2 }, { day: "2026-11-10", count: 1 }, { day: "2026-11-12", count: 1 }, { day: "2025-01-01", count: 9 }])).toEqual([1, 0, 3]);
  });
  it("checks the Brevo list against the waitlist, caching the answer", async () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response(JSON.stringify({ uniqueSubscribers: 10 }), { status: 200 }); }) as typeof fetch;
    expect(await brevoChecker({})(5)).toMatchObject({ state: "not_configured" });
    const check = brevoChecker({ apiKey: "k", listId: "7", fetch: fetcher, now: () => now });
    expect(await check(10)).toMatchObject({ state: "synced", listCount: 10 });
    expect(await check(12)).toMatchObject({ state: "behind", listCount: 10, waitlistCount: 12 });
    expect(calls).toBe(1);
    const broken = brevoChecker({ apiKey: "k", listId: "7", fetch: (async () => new Response("", { status: 401 })) as typeof fetch, now: () => now });
    expect(await broken(1)).toMatchObject({ state: "error" });
  });
  it("neutralises spreadsheet formulas and parses health targets", () => {
    expect(csvField("=HYPERLINK(1)")).toBe("\"'=HYPERLINK(1)\"");
    expect(csvField("a\"b")).toBe("\"a\"\"b\"");
    expect(csvField(null)).toBe("\"\"");
    expect(healthTargets("link=https://link.dusk.bot/health, bad=ftp://x, =http://y, site=http://127.0.0.1:3106/")).toEqual([
      { name: "link", url: "https://link.dusk.bot/health" }, { name: "site", url: "http://127.0.0.1:3106/" }]);
  });
});

// needs a replica set: DUSK_TEST_MONGODB_URI names a server whose user may drop DUSK_TEST_MONGODB_DB (default dusk_test)
const uri = process.env.DUSK_TEST_MONGODB_URI, dbName = process.env.DUSK_TEST_MONGODB_DB || "dusk_test";
describe.skipIf(!uri)("analytics in mongodb", () => {
  let client: MongoClient;
  afterAll(async () => { for (const name of ["analytics_events", "analytics_daily", "analytics_marks", "admin_audit"]) await client.db(dbName).collection(name).drop().catch(() => {}); await client.close(); });
  it("stores events with a TTL, counts days, marks once, and forgets an account", async () => {
    client = await MongoClient.connect(uri!);
    const db = client.db(dbName);
    for (const name of ["analytics_events", "analytics_daily", "analytics_marks", "admin_audit"]) await db.collection(name).drop().catch(() => {});
    const sink = await mongoSink(db);
    const at = Date.now();
    await sink.insert({ id: "ev_1", name: "sign_in", at, accountId: "acct_1", props: { kind: "web" }, ctx: { country: "DE" } });
    await sink.insert({ id: "ev_2", name: "page_view", at: at + 1, accountId: null, props: { path: "/" } });
    await sink.bump("2026-11-12", "sign_in"); await sink.bump("2026-11-12", "sign_in");
    expect(await sink.daily(["sign_in"], "2026-11-01", "2026-11-30")).toEqual([{ day: "2026-11-12", name: "sign_in", count: 2 }]);
    expect(await sink.once("k", at + DAY)).toBe(true);
    expect(await sink.once("k", at + DAY)).toBe(false);
    expect((await sink.events({ limit: 10 })).map(event => event.id)).toEqual(["ev_2", "ev_1"]);
    expect((await sink.events({ accountId: "acct_1", limit: 10 }))[0]!.ctx).toEqual({ country: "DE" });
    expect([...await sink.accounts(["sign_in"], at - 1)]).toEqual(["acct_1"]);
    await sink.forget("acct_1");
    expect((await sink.events({ limit: 10 })).map(event => event.id)).toEqual(["ev_2"]);
    const ttl = (await db.collection("analytics_events").indexes()).find(index => index.expireAfterSeconds !== undefined);
    expect(ttl?.expireAfterSeconds).toBe(400 * 86_400);
    expect((await sink.health()).ok).toBe(true);
  });
});
