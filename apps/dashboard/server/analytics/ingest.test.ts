import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardApp } from "../app.ts";
import { memoryMailer } from "../auth/mail.ts";
import { memorySink } from "./sink.ts";
import { CSRF_HEADER } from "../../../../shared/account-api.ts";

const ORIGIN = "http://127.0.0.1:7998", SITE = "https://dusk.bot";
const ADMIN = "owner@example.test", OTHER = "someone@example.test";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const VID = "AbCdEfGhIjKlMnOpQrStUv", SID = "ZyXwVuTsRqPoNmLkJiHgFe";
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe("site tracker and app ingest", () => {
  let app: ReturnType<typeof createDashboardApp>, sink: ReturnType<typeof memorySink>, mailer: ReturnType<typeof memoryMailer>;
  let server: Server, url: string, dataDir: string, time: number;
  const csrf = new Map<string, string>();
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "omb-ingest-test-"));
    time = Date.parse("2026-11-12T12:00:00Z");
    sink = memorySink(() => time);
    mailer = memoryMailer();
    app = createDashboardApp({ dataDir, publicUrl: ORIGIN, mailer, staticDir: null, now: () => time, trustProxy: true, analytics: { sink, trackOrigins: [SITE] }, admin: { emails: [ADMIN], env: {} } });
    server = createServer(app.handle);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    app.close();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    rmSync(dataDir, { recursive: true, force: true });
  });
  const beacon = (body: unknown, headers: Record<string, string> = {}) => fetch(`${url}/v1/t`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "text/plain;charset=UTF-8", origin: SITE, "user-agent": SAFARI, ...headers } });
  const view = (extra: Record<string, unknown> = {}) => ({ v: 1, e: "pageview", vid: VID, sid: SID, pv: "pv000001", h: "dusk.bot", p: "/pricing", w: 1440, ...extra });
  async function login(email: string) {
    const start = await fetch(`${url}/v1/auth/start`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email }) });
    const { attempt } = await start.json() as { attempt: string };
    const code = mailer.outbox.findLast(item => item.to === email)!.text.match(/\b\d{8}\b/)![0];
    const verify = await fetch(`${url}/v1/auth/verify`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ attempt, code }) });
    const cookie = verify.headers.get("set-cookie")!.split(";")[0]!;
    csrf.set(cookie, (await verify.json() as { csrfToken: string }).csrfToken);
    return cookie;
  }
  async function appToken(email: string) {
    const device = { deviceName: "Test Mac", platform: "darwin", appVersion: "0.3.0" };
    const start = await fetch(`${url}/api/cloud/app/sign-in/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, ...device }) });
    const { attempt } = await start.json() as { attempt: string };
    const code = mailer.outbox.findLast(item => item.to === email)!.text.match(/\b\d{8}\b/)![0];
    const verify = await fetch(`${url}/api/cloud/app/sign-in/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attempt, code }) });
    return (await verify.json() as { accessToken: string }).accessToken;
  }

  it("stores a page view with its visit, attribution, device and Cloudflare geo", async () => {
    const res = await beacon(view({ r: "chatgpt.com", u: { utm_campaign: "Launch", ref: "x-thread", email: "a@b.c" } }),
      { "x-forwarded-for": "203.0.113.4, 172.70.1.1", "cf-ipcountry": "DE", "cf-ipcity": "Berlin", "cf-iplatitude": "52.52", "cf-iplongitude": "13.405" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    await settle();
    expect(sink.all).toHaveLength(1);
    expect(sink.all[0]).toMatchObject({ name: "site_view", accountId: null, props: { path: "/pricing" },
      ctx: { visitor: VID, session: SID, pv: "pv000001", host: "dusk.bot", page: "/pricing", referrer: "chatgpt.com", ref: "x-thread", utm: { campaign: "launch" }, channel: "referral",
        device: "desktop", os: "mac", browser: "safari", country: "DE", city: "Berlin", lat: 52.5, lon: 13.4, width: 1440 } });
    expect(JSON.stringify(sink.all)).not.toContain("a@b.c");
    expect(JSON.stringify(sink.all)).not.toContain("203.0.113.4");
  });

  it("stores goals and page ends, and refuses what it should not count", async () => {
    await beacon({ v: 1, e: "goal", vid: VID, sid: SID, pv: "pv000001", h: "dusk.bot", p: "/", g: "cta_click", m: { to: "/app/signup", from: "/" } });
    await beacon({ v: 1, e: "leave", vid: VID, sid: SID, pv: "pv000001", h: "dusk.bot", p: "/", s: 140, t: 5200.4 });
    expect((await beacon({ ...view(), e: "goal", g: "Bad Goal" })).status).toBe(400);
    expect((await beacon(view(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await beacon(view({ h: "evil.example" }))).status).toBe(400);
    expect((await beacon(view({ vid: "short" }))).status).toBe(400);
    expect((await beacon("not json")).status).toBe(400);
    expect((await beacon("x".repeat(5000))).status).toBe(413);
    expect((await beacon(view(), { "user-agent": "Googlebot/2.1" })).status).toBe(204);
    expect((await beacon(view(), { "sec-gpc": "1" })).status).toBe(204);
    await settle();
    expect(sink.all.map(event => [event.name, event.props])).toEqual([["site_goal", { goal: "cta_click", to: "/app/signup", from: "/" }], ["site_leave", { path: "/", scroll: 100, ms: 5200 }]]);
  });

  it("never counts the owner's own visits", async () => {
    const admin = await login(ADMIN);
    const before = sink.all.length;
    expect((await fetch(`${url}/v1/t`, { method: "POST", body: JSON.stringify(view({ h: "127.0.0.1" })), headers: { "content-type": "text/plain", origin: ORIGIN, "user-agent": SAFARI, cookie: admin } })).status).toBe(204);
    await settle();
    expect(sink.all.length).toBe(before);
  });

  it("links a site visitor to the account that signs in on the same domain, once", async () => {
    const cookie = await login(OTHER);
    for (let n = 0; n < 2; n++) await fetch(`${url}/v1/events`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `${cookie}; dusk_vid=${VID}`, [CSRF_HEADER]: csrf.get(cookie)! },
      body: JSON.stringify({ events: [{ name: "page_view", props: { path: "/" } }] }) });
    await settle();
    const id = app.auth.accountByEmail(OTHER)!.id;
    const links = sink.all.filter(event => event.name === "identify");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ accountId: id, props: { via: "page" }, ctx: { visitor: VID } });
  });

  it("takes app usage anonymously, then identifies the install when the app signs in", async () => {
    const install = "inst_0123456789abcdef";
    const send = (body: unknown, token?: string) => fetch(`${url}/v1/app/events`, { method: "POST", headers: { "content-type": "application/json", origin: "app://dusk", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const events = [{ name: "app_open", props: { kind: "desktop", platform: "darwin", appVersion: "0.3.0" } }, { name: "app_screen", props: { screen: "/bots/ws_abcdefghijk" } },
      { name: "app_messages", props: { sent: 3, replies: 3, latencyMs: 1800, text: "never" } }, { name: "signup" }, { name: "app_feature", props: { feature: "rm_rf" } }];
    const anon = await send({ install, platform: "darwin", version: "0.3.0", session: "sess_0123456789abcdef", events });
    expect(anon.status).toBe(204);
    expect(anon.headers.get("access-control-allow-origin")).toBe("*");
    await settle();
    expect(sink.all.map(event => [event.name, event.accountId, event.props])).toEqual([
      ["app_open", null, { kind: "desktop", platform: "darwin", appVersion: "0.3.0" }], ["app_screen", null, { screen: "/bots/:id" }],
      ["app_messages", null, { sent: 3, replies: 3, latencyMs: 1800 }], ["app_feature", null, {}]]);
    expect(sink.all[0]!.ctx).toMatchObject({ install, session: "sess_0123456789abcdef", app: { platform: "darwin", version: "0.3.0" } });
    const token = await appToken(OTHER);
    expect((await send({ install, events: [{ name: "app_feature", props: { feature: "bot_created" } }] }, token)).status).toBe(204);
    await settle();
    const id = app.auth.accountByEmail(OTHER)!.id;
    expect(sink.all.find(event => event.name === "identify")).toMatchObject({ accountId: id, props: { via: "app" }, ctx: { install } });
    expect(sink.all.findLast(event => event.name === "app_feature")).toMatchObject({ accountId: id, props: { feature: "bot_created" } });
    expect((await send({ install: "x", events })).status).toBe(400);
    expect((await send({ install, events: Array.from({ length: 51 }, () => events[0]) })).status).toBe(400);
  });
});
