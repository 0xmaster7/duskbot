// @vitest-environment happy-dom
// isolated marketing analytics tracker tests
// ideas from Minilytics (MIT, Copyright (c) 2026 surendrapandar)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { gzipSync } from "node:zlib";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve("apps/dashboard/tracker/dusk.js"), "utf8");
type Payload = {
  v: number; e: string; vid: string; sid: string; pv: string; h: string; p: string;
  u?: Record<string, string>; r?: string; w?: number; g?: string;
  m?: Record<string, string | number>; s?: number; t?: number;
};
type Api = ((name: unknown, meta?: unknown) => void) & { q?: IArguments[] };

describe("marketing tracker", () => {
  let win: Window & { dusk?: Api };
  let script: HTMLScriptElement;
  let payloads: Payload[];
  let pending: Promise<void>[];
  let beacon: ReturnType<typeof vi.fn>;
  let fetch: ReturnType<typeof vi.fn>;
  let now: number;

  function property(target: object, key: string, value: unknown) {
    Object.defineProperty(target, key, { configurable: true, value });
  }
  function visibility(state: string) {
    property(win.document, "visibilityState", state);
    win.document.dispatchEvent(new win.Event("visibilitychange"));
  }
  async function events() {
    await Promise.all(pending);
    return payloads;
  }
  async function load() {
    new Function("window", "document", "navigator", "URL", "URLSearchParams", "Blob", source)(
      win, win.document, win.navigator, win.URL, win.URLSearchParams, win.Blob,
    );
    return events();
  }
  function click(html: string, selector = "a") {
    win.document.body.innerHTML = html;
    win.document.querySelector(selector)!.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  }
  function submit(html: string) {
    win.document.body.innerHTML = html;
    win.document.querySelector("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  }

  beforeEach(() => {
    win = new Window({ url: "https://preview.dusk.bot/pricing?utm_source=x&email=a@b.c&ref=launch" });
    for (const cookie of win.document.cookie.split(";")) win.document.cookie = `${cookie.split("=")[0]}=; path=/; max-age=0`;
    win.localStorage.clear();
    win.history.replaceState(null, "", "/pricing?utm_source=x&email=a@b.c&ref=launch");
    win.document.body.innerHTML = "";
    property(win.document, "visibilityState", "visible");
    property(win.document, "referrer", "https://search.example/results?private=value");
    property(win.navigator, "userAgent", "Mozilla/5.0 Safari/605.1.15");
    property(win.navigator, "webdriver", false);
    property(win.navigator, "doNotTrack", null);
    property(win.navigator, "globalPrivacyControl", false);
    property(win, "innerWidth", 1280);
    property(win, "innerHeight", 500);
    property(win, "scrollY", 0);
    property(win.document.documentElement, "scrollHeight", 2000);
    script = win.document.createElement("script") as unknown as HTMLScriptElement;
    script.setAttribute("data-api", "https://t.example/v1/t");
    property(win.document, "currentScript", script);
    payloads = [];
    pending = [];
    beacon = vi.fn((_endpoint: string, body: Blob) => {
      pending.push(body.text().then(text => { payloads.push(JSON.parse(text)); }));
      return true;
    });
    fetch = vi.fn(() => Promise.resolve({ ok: true }));
    property(win.navigator, "sendBeacon", beacon);
    property(win, "fetch", fetch);
    now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await win.happyDOM.close();
  });

  it("sends only permitted pageview fields and sets shared secure cookies", async () => {
    const writes: string[] = [];
    let prototype: object | null = win.document;
    let descriptor: PropertyDescriptor | undefined;
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, "cookie");
      prototype = Object.getPrototypeOf(prototype);
    }
    expect(descriptor?.set).toBeTypeOf("function");
    Object.defineProperty(win.document, "cookie", {
      configurable: true,
      get() { return descriptor!.get!.call(this); },
      set(value: string) { writes.push(value); descriptor!.set!.call(this, value); },
    });
    const [page] = await load();
    now++;
    expect(page).toEqual({
      v: 1, e: "pageview", vid: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      sid: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), pv: expect.stringMatching(/^[A-Za-z0-9_-]{8}$/),
      h: "preview.dusk.bot", p: "/pricing", u: { utm_source: "x", ref: "launch" }, r: "search.example", w: 1280,
    });
    expect(beacon.mock.calls[0]![0]).toBe("https://t.example/v1/t");
    expect(beacon.mock.calls[0]![1].type).toBe("text/plain");
    expect(win.document.cookie).toContain(`dusk_vid=${page!.vid}`);
    expect(win.document.cookie).toContain(`dusk_sid=${page!.sid}`);
    expect(win.document.cookie).not.toContain("dusk_test");
    expect(writes).toContain(`dusk_vid=${page!.vid}; path=/; SameSite=Lax; Secure; max-age=31536000; domain=dusk.bot`);
    expect(writes).toContain(`dusk_sid=${page!.sid}; path=/; SameSite=Lax; Secure; max-age=1800; domain=dusk.bot`);
    win.happyDOM.setURL("https://dusk.bot/");
    expect(win.document.cookie).toContain(`dusk_vid=${page!.vid}`);
  });

  it("reuses existing IDs and omits referrer in an existing session", async () => {
    win.document.cookie = "dusk_vid=existing_visitor; path=/";
    win.document.cookie = "dusk_sid=existing_session; path=/";
    expect((await load())[0]).toMatchObject({ vid: "existing_visitor", sid: "existing_session" });
    expect(payloads[0]).not.toHaveProperty("r");
  });

  it.each(["", "https://preview.dusk.bot/other"])("omits absent or same-host referrer %s", async referrer => {
    property(win.document, "referrer", referrer);
    expect((await load())[0]).not.toHaveProperty("r");
  });

  it("redacts path segments, bounds the path and filters attribution values", async () => {
    win.history.replaceState(null, "", `/people/a@b.c/encoded%40id/${"a".repeat(220)}?utm_source=a%40b.c&utm_term=${"t".repeat(120)}&via=docs&source=blog&token=secret`);
    const [page] = await load();
    expect(page!.p).toBe(`/people/:id/:id/${"a".repeat(220)}`.slice(0, 200));
    expect(page!.u).toEqual({ utm_term: "t".repeat(100), via: "docs", source: "blog" });
    win.history.pushState(null, "", "/clean");
    await events();
    expect(payloads.at(-1)).not.toHaveProperty("u");
    expect(payloads.at(-1)).not.toHaveProperty("r");
  });

  it.each(["param", "flag"])("honors the ignore %s and installs an inert API", async mode => {
    if (mode === "param") win.history.replaceState(null, "", "/?dusk_ignore=1");
    else win.localStorage.setItem("dusk_ignore", "1");
    await load();
    expect(win.localStorage.getItem("dusk_ignore")).toBe("1");
    expect(() => win.dusk!("test")).not.toThrow();
    click('<a href="https://elsewhere.example">elsewhere</a>');
    expect(beacon).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(win.document.cookie).toBe("");
  });

  it("checks the ignore URL before the persisted flag", async () => {
    win.localStorage.setItem("dusk_ignore", "1");
    win.history.replaceState(null, "", "/?dusk_ignore=0");
    expect(await load()).toHaveLength(1);
    expect(win.localStorage.getItem("dusk_ignore")).toBeNull();
  });

  it.each([["webdriver", true], ["doNotTrack", "1"], ["globalPrivacyControl", true], ["userAgent", "Googlebot/2.1"], ["userAgent", "HeadlessChrome"], ["userAgent", "curl/8"]])("skips %s=%s", async (key, value) => {
    property(win.navigator, key as string, value);
    await load();
    win.dusk!("test");
    expect(beacon).not.toHaveBeenCalled();
    expect(win.document.cookie).toBe("");
  });

  it.each(["http://localhost/", "http://127.1.2.3/", "http://0.0.0.0/", "http://[::1]/", "https://site.local/", "file:///tmp/index.html"])("skips local URL %s", async url => {
    win.happyDOM.setURL(url);
    await load();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("allows explicit local tracking and defaults the endpoint relative to the page", async () => {
    win.happyDOM.setURL("http://localhost/");
    script.setAttribute("data-allow-local", "");
    script.removeAttribute("data-api");
    expect(await load()).toHaveLength(1);
    expect(beacon.mock.calls[0]![0]).toBe("/v1/t");
  });

  it("replays queued calls and sanitizes direct goal metadata", async () => {
    win.dusk = function () { (win.dusk!.q = win.dusk!.q || []).push(arguments); };
    win.dusk("queued_goal", { placement: "hero" });
    await load();
    win.dusk!("buy_1", { text: "x".repeat(120), count: 3, bad: false, nested: {}, infinity: Infinity, nan: NaN, a: "a", b: "b", c: "c", sixth: "drop" });
    await events();
    expect(payloads.map(p => p.e)).toEqual(["pageview", "goal", "goal"]);
    expect(payloads[1]).toMatchObject({ g: "queued_goal", m: { placement: "hero" } });
    expect(payloads[2]!.m).toEqual({ text: "x".repeat(100), count: 3, a: "a", b: "b", c: "c" });
    expect(payloads[2]).not.toHaveProperty("u");
    expect(payloads[2]).not.toHaveProperty("r");
    expect(payloads[2]).not.toHaveProperty("w");
  });

  it("drops invalid goal names", async () => {
    await load();
    for (const name of ["", "UPPER", "has space", "hy-phen", "a".repeat(41), null, 123]) win.dusk!(name);
    expect(await events()).toHaveLength(1);
  });

  it("captures an ancestor's explicit goal and data attributes once", async () => {
    await load();
    click('<a href="/app" data-dusk-goal="hero_click" data-dusk-placement="hero" data-dusk-plan="pro"><span>start</span></a>', "span");
    await events();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({ g: "hero_click", m: { placement: "hero", plan: "pro" } });
  });

  it.each(["/app", "/signup/new", "https://app.preview.dusk.bot/app"])("tracks CTA %s", async href => {
    await load();
    click(`<a href="${href}"><span>start</span></a>`, "span");
    await events();
    expect(payloads[1]).toMatchObject({ g: "cta_click", m: { to: new URL(href, win.location.href).pathname, from: "/pricing" } });
  });

  it.each(["/download/mac", "https://cdn.example/Dusk.DMG?token=private", "/dusk.exe", "/dusk.msi", "/dusk.appimage", "/dusk.deb", "/dusk.rpm"])("tracks download %s", async href => {
    await load();
    click(`<a href="${href}">download</a>`);
    await events();
    expect(payloads[1]).toMatchObject({ g: "download_click", m: { to: new URL(href, win.location.href).pathname } });
  });

  it("tracks external hosts without leaking URLs or misclassifying suffix lookalikes", async () => {
    await load();
    click('<a href="https://evilpreview.dusk.bot/signup?email=a@b.c">external</a>');
    await events();
    expect(payloads[1]).toMatchObject({ g: "outbound", m: { host: "evilpreview.dusk.bot" } });
    click('<a href="mailto:a@b.c">email</a>');
    click('<a href="/docs">docs</a>');
    expect(await events()).toHaveLength(2);
  });

  it.each(["id", "class", "action", "name"])("tracks valid waitlist forms by %s without sending email", async attr => {
    await load();
    submit(`<form ${attr}="join-waitlist"><input type="email" value="person@example.com"></form>`);
    await events();
    expect(payloads[1]).toMatchObject({ e: "goal", g: "waitlist_join" });
    expect(payloads[1]).not.toHaveProperty("m");
    expect(JSON.stringify(payloads)).not.toContain("person@example.com");
  });

  it("tracks the dusk.bot waitlist form by its wl-form class", async () => {
    await load();
    submit('<form class="wl-form" data-wl-form novalidate><input type="email" value="person@example.com"></form>');
    await events();
    expect(payloads[1]).toMatchObject({ e: "goal", g: "waitlist_join" });
  });

  it("ignores invalid waitlist forms and honors explicit form goals", async () => {
    await load();
    submit('<form id="waitlist"><input type="email" value="invalid"></form>');
    submit('<form><input type="email" value="a@b.c"></form>');
    submit('<form id="waitlist" data-dusk-goal="custom_join" data-dusk-placement="footer"><input type="email" value="a@b.c"></form>');
    await events();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({ g: "custom_join", m: { placement: "footer" } });
  });

  it("sends leave for the old path before a fresh SPA pageview", async () => {
    await load();
    const initial = payloads[0]!;
    now += 250;
    win.history.pushState(null, "", "/signup?utm_source=spa");
    await events();
    expect(payloads.map(p => p.e)).toEqual(["pageview", "leave", "pageview"]);
    expect(payloads[1]).toMatchObject({ pv: initial.pv, p: "/pricing", s: 25, t: 250 });
    expect(payloads[2]).toMatchObject({ p: "/signup", u: { utm_source: "spa" } });
    expect(payloads[2]!.pv).not.toBe(initial.pv);
    expect(payloads[2]!.sid).toBe(initial.sid);
    win.history.replaceState(null, "", "/signup?ref=query_only#hash");
    win.dispatchEvent(new win.PopStateEvent("popstate"));
    expect(await events()).toHaveLength(3);
    win.history.replaceState(null, "", "/next");
    await events();
    expect(payloads.slice(-2).map(p => p.e)).toEqual(["leave", "pageview"]);
    win.happyDOM.setURL("https://preview.dusk.bot/back");
    win.dispatchEvent(new win.PopStateEvent("popstate"));
    await events();
    expect(payloads.at(-1)!.p).toBe("/back");
  });

  it("reports cumulative scroll and visible time on hides and pagehide", async () => {
    await load();
    property(win, "scrollY", 1000);
    win.dispatchEvent(new win.Event("scroll"));
    now += 120;
    visibility("hidden");
    await events();
    expect(payloads[1]).toMatchObject({ e: "leave", s: 75, t: 120 });
    now += 5000;
    visibility("visible");
    property(win, "scrollY", 0);
    now += 80;
    visibility("hidden");
    win.dispatchEvent(new win.Event("pagehide"));
    await events();
    expect(payloads.slice(-2)).toEqual([expect.objectContaining({ s: 75, t: 200 }), expect.objectContaining({ s: 75, t: 200 })]);
    expect(new Set(payloads.map(p => p.pv)).size).toBe(1);
  });

  it("suppresses empty hides but always closes a view on pathname changes", async () => {
    property(win.document, "visibilityState", "hidden");
    property(win, "innerHeight", 0);
    await load();
    visibility("hidden");
    win.dispatchEvent(new win.Event("pagehide"));
    expect(await events()).toHaveLength(1);
    win.history.pushState(null, "", "/next");
    await events();
    expect(payloads.map(p => p.e)).toEqual(["pageview", "leave", "pageview"]);
    expect(payloads[1]).toMatchObject({ s: 0, t: 0 });
  });

  it("waits through prerender and replays queued goals after the pageview", async () => {
    property(win.document, "visibilityState", "prerender");
    win.dusk = function () { (win.dusk!.q = win.dusk!.q || []).push(arguments); };
    win.dusk("queued");
    expect(await load()).toHaveLength(0);
    now += 1000;
    visibility("visible");
    await events();
    expect(payloads.map(p => p.e)).toEqual(["pageview", "goal"]);
    now += 50;
    visibility("hidden");
    await events();
    expect(payloads.at(-1)!.t).toBe(50);
  });

  it.each(["false", "missing", "throws"])("falls back to fetch when beacon %s", async mode => {
    if (mode === "false") beacon.mockReturnValue(false);
    if (mode === "missing") property(win.navigator, "sendBeacon", undefined);
    if (mode === "throws") beacon.mockImplementation(() => { throw new Error("unavailable"); });
    await load();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual(["https://t.example/v1/t", {
      method: "POST", body: expect.any(String), keepalive: true, headers: { "content-type": "text/plain" },
    }]);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ e: "pageview", p: "/pricing" });
  });

  it("swallows storage, transport and public API errors", async () => {
    property(win, "localStorage", { getItem() { throw new Error("blocked"); } });
    beacon.mockImplementation(() => { throw new Error("blocked"); });
    fetch.mockRejectedValue(new Error("offline"));
    await expect(load()).resolves.toEqual([]);
    expect(() => win.dusk!("goal", { get value() { throw new Error("getter"); } })).not.toThrow();
    expect(() => win.history.pushState(null, "", "https://other.example/")).not.toThrow();
    expect(() => visibility("hidden")).not.toThrow();
    await Promise.resolve();
  });

  it("fits the gzip budget", () => {
    expect(gzipSync(source).length).toBeLessThanOrEqual(4096);
  });
});
