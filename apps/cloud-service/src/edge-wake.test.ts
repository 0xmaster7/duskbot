// the public edge (edge/worker.js) in front of a sleeping home: a webhook or a signed-in client wakes it and is held
// until it answers; anonymous traffic never wakes it; strangers get a small hourly budget of wakes
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { wakeReason } from "../edge/worker.js";
import { boatFixture } from "./test-fixture.ts";

const TOKEN = "e".repeat(40), DOMAIN = "desktops.example.com", ROUTE_URL = "https://dash.example.test";
afterEach(() => vi.unstubAllGlobals());

async function edged(edgeWakesPerHour = 3) {
  const f = await boatFixture({ settings: { publicDomain: DOMAIN, edgeWakesPerHour }, edgeToken: TOKEN });
  const { c } = await f.paid();
  const handle = f.service.managed!.handle!;
  const hooks: Array<{ path: string; body: string }> = [];
  // the account service's routes as the Worker reaches them, and the machine's hosted url, which answers only while up
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === ROUTE_URL) {
      const req = Object.assign(new PassThrough(), { method: request.method, url: url.pathname + url.search, headers: Object.fromEntries(request.headers), socket: { remoteAddress: "198.51.100.1" } }) as unknown as IncomingMessage;
      (req as unknown as PassThrough).end("");
      let status = 0, text = "";
      const res = { setHeader() {}, writeHead(code: number) { status = code; }, end(data: string) { text = data; } } as unknown as ServerResponse;
      await handle(req, res, url, { publicUrl: ROUTE_URL, json: (r, code, data) => { r.writeHead(code); r.end(JSON.stringify(data)); }, readJson: async () => ({}), clientIp: () => "198.51.100.1" });
      return new Response(text, { status });
    }
    if (url.origin === c.managed!.upstream) {
      if (f.api.sandboxes.get(c.serverId!)!.state !== "ready") return new Response("down", { status: 502 });
      hooks.push({ path: url.pathname, body: await request.text() });
      return new Response("ok", { status: 200, headers: { server: "machine", "x-powered-by": "x" } });
    }
    throw new Error(`unexpected request to ${url.href}`);
  });
  const env = { ROUTE_URL, EDGE_TOKEN: TOKEN, PUBLIC_DOMAIN: DOMAIN }, ctx = { waitUntil() {} };
  const send = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${c.origin}${path}`, init), env, ctx);
  async function asleep() {
    await f.asleep(c);
    await f.service.reconcile();
    expect(f.api.sandboxes.get(c.serverId!)!.state).toBe("archived");
    f.power.idle = false; f.power.busy = ["recent-activity"];
  }
  return { f, c, hooks, send, asleep };
}

describe("the public edge and a sleeping home", () => {
  it("forwards to an awake home and hides the machine's own headers", async () => {
    const { send, hooks } = await edged();
    const response = await send("/hooks/github", { method: "POST", body: "{\"a\":1}" });
    expect(response.status).toBe(200);
    expect(response.headers.get("server")).toBeNull();
    expect(hooks).toEqual([{ path: "/hooks/github", body: "{\"a\":1}" }]);
  });

  it("wakes a sleeping home for a webhook, holds it, and delivers the payload as it was sent", async () => {
    const { f, c, send, hooks, asleep } = await edged();
    await asleep();
    const started = Date.now();
    const response = await send("/hooks/github", { method: "POST", body: "{\"ref\":\"main\"}", headers: { "x-hub-signature-256": "sha256=abc" } });
    expect(response.status).toBe(200);
    expect(hooks).toEqual([{ path: "/hooks/github", body: "{\"ref\":\"main\"}" }]);
    expect(c.status).toBe("running");
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(f.audit.entries(c.id).map(e => `${e.action}:${e.actor}`)).toEqual(expect.arrayContaining(["wake_asked:edge", "awake:reconciler"]));
  }, 30_000);

  it("never wakes a home for anonymous traffic, and webhook storms never make it flap", async () => {
    const { f, c, send, asleep } = await edged(60);
    await asleep();
    const anonymous = await send("/");
    expect(anonymous.status).toBe(503);
    expect(anonymous.headers.get("retry-after")).toBe("5");
    await f.service.reconcile();
    expect(f.api.sandboxes.get(c.serverId!)!.state).toBe("archived");
    // a stranger's webhook every few minutes: each wake is a start, so the home's start budget keeps it up instead
    for (let n = 0; n < 12; n++) {
      expect((await send("/hooks/x", { method: "POST", body: "1" })).status).toBe(200);
      f.power.idle = true; f.power.busy = [];
      for (let k = 0; k < 2 && c.status !== "sleeping"; k++) { f.advance(4 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
    }
    const starts = f.audit.entries(c.id).filter(e => e.action === "wake" || e.action === "create").map(e => e.at);
    for (const t of starts) expect(starts.filter(x => x > t - 3_600_000 && x <= t).length).toBeLessThanOrEqual(4);
    expect(starts.length).toBeLessThan(12);
  }, 90_000);

  it("caps the wakes strangers can cause at the edge", async () => {
    const { f, c, send, asleep } = await edged(1);
    await asleep();
    expect((await send("/hooks/x", { method: "POST", body: "1" })).status).toBe(200);
    await asleep();
    const capped = await send("/hooks/x", { method: "POST", body: "1" });
    expect(capped.status).toBe(429);
    expect(f.api.sandboxes.get(c.serverId!)!.state).toBe("archived");
  }, 90_000);

  it("never wakes a home whose plan ended or that an operator suspended", async () => {
    const { f, c, send, asleep } = await edged();
    await asleep();
    f.subscriptions[0]!.status = "canceled" as never;
    (f.subscriptions[0] as unknown as { currentPeriodEnd: number }).currentPeriodEnd = f.now() - 1;
    expect((await send("/hooks/x", { method: "POST", body: "1", headers: { authorization: "Bearer x" } })).status).toBe(503);
    expect(c.wantPower).toBe("off");
  });

  it("tells a webhook and a credentialed client from anonymous traffic", () => {
    const at = (path: string, headers: Record<string, string> = {}) => wakeReason(new Request(`https://d.example${path}`, { headers }), new URL(`https://d.example${path}`));
    expect(at("/hooks/slack")).toBe("webhook");
    // reading chats or opening the app never wakes: only an action does
    expect(at("/api/bots", { authorization: "Bearer t" })).toBeNull();
    expect(at("/", { cookie: "s=1" })).toBeNull();
    expect(wakeReason(new Request("https://d.example/api/bots/b1/messages", { method: "POST", headers: { authorization: "Bearer t" } }), new URL("https://d.example/api/bots/b1/messages"))).toBe("client");
    expect(wakeReason(new Request("https://d.example/api/bots/b1/messages", { method: "POST" }), new URL("https://d.example/api/bots/b1/messages"))).toBeNull();
    expect(at("/")).toBeNull();
    expect(at("/favicon.ico")).toBeNull();
  });
});
