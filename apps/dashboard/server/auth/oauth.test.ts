import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardApp, type DashboardAppOptions } from "../app.ts";
import { startFakeProviders } from "./fake-providers.ts";
import { memoryMailer } from "./mail.ts";
import { providersFromEnv } from "./providers.ts";
import { APP_AUTH_REDIRECT, CSRF_HEADER, type AccountAnswer, type AppGrant, type OAuthProvider, type WebSignInAnswer } from "../../../../shared/account-api.ts";

class CookieJar {
  values = new Map<string, string>();
  read(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(";")[0]!.split("=");
      if (cookie.includes("Max-Age=0")) this.values.delete(name!); else this.values.set(name!, value!);
    }
  }
  header() { return [...this.values].map(([name, value]) => `${name}=${value}`).join("; "); }
}
const decodeHtml = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity]!);
const random = () => randomBytes(32).toString("base64url");
const mobile = { deviceName: "Fixture phone", platform: "ios", appVersion: "1.0.0" };
describe("OAuth over isolated HTTP", () => {
  let fake: Awaited<ReturnType<typeof startFakeProviders>>, server: Server, app: ReturnType<typeof createDashboardApp>, options: DashboardAppOptions;
  let dataDir: string, url: string, time: number, jar: CookieJar, mailer: ReturnType<typeof memoryMailer>;
  beforeEach(async () => {
    fake = await startFakeProviders(); dataDir = mkdtempSync(join(tmpdir(), "omb-oauth-")); time = Date.now(); jar = new CookieJar(); mailer = memoryMailer();
    server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error();
    url = `http://127.0.0.1:${address.port}`;
    options = { dataDir, publicUrl: url, mailer, oauth: fake.config, staticDir: null, now: () => time };
    app = createDashboardApp(options); server.on("request", app.handle);
  });
  afterEach(async () => {
    app.close(); await fake.close();
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    rmSync(dataDir, { recursive: true, force: true });
  });
  function restart(changes: Partial<DashboardAppOptions>) {
    app.close(); options = { ...options, ...changes }; app = createDashboardApp(options); server.removeAllListeners("request"); server.on("request", app.handle);
  }
  async function call(path: string, data?: unknown, headers: Record<string, string> = {}, method = data === undefined ? "GET" : "POST", browser = jar) {
    const res = await fetch(new URL(path, url), { redirect: "manual", method, headers: { cookie: browser.header(), ...(data === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    browser.read(res); return res;
  }
  const location = (response: Response) => { expect(response.status).toBe(302); return response.headers.get("location")!; };
  async function authorization(provider: OAuthProvider, query = "") {
    const start = await call(`/v1/auth/oauth/${provider}/start${query}`);
    const authorizeUrl = location(start);
    const response = await fetch(authorizeUrl, { redirect: "manual" });
    if (provider !== "apple") return { callback: location(response), method: "GET", body: undefined };
    expect(response.status).toBe(200);
    const html = await response.text(), body = new URLSearchParams();
    for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) body.set(match[1]!, decodeHtml(match[2]!));
    return { callback: decodeHtml(/action="([^"]+)"/.exec(html)![1]!), method: "POST", body: body.toString() };
  }
  async function callback(auth: Awaited<ReturnType<typeof authorization>>, browser = jar) {
    const res = await fetch(auth.callback, { redirect: "manual", method: auth.method, headers: { cookie: browser.header(), ...(auth.body ? { "content-type": "application/x-www-form-urlencoded", origin: "https://appleid.apple.com" } : {}) }, body: auth.body });
    browser.read(res); return res;
  }
  const oauth = async (provider: OAuthProvider, query = "") => callback(await authorization(provider, query));
  const account = async () => (await (await call("/v1/account")).json()) as AccountAnswer;
  const error = (res: Response) => new URL(location(res), url).searchParams.get("error");
  async function emailLogin(email = "sid@openmausbot.test", pending?: string) {
    const start = await call("/v1/auth/start", { email, ...(pending ? { pending } : {}) }); expect(start.status).toBe(200);
    const { attempt } = await start.json() as { attempt: string };
    const code = mailer.outbox.findLast(message => message.to === email)!.text.match(/\b\d{8}\b/)![0];
    return call("/v1/auth/verify", { attempt, code });
  }
  async function appAuthorization(provider = "google", changes: Record<string, string> = {}, verifier = random()) {
    const appState = random();
    const params = new URLSearchParams({ provider, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: appState, redirect_uri: APP_AUTH_REDIRECT, ...changes });
    const started = await call(`/v1/auth/app/start?${params}`);
    const providerResponse = await fetch(location(started), { redirect: "manual" });
    const res = await call(location(providerResponse));
    return { verifier, state: appState, response: res, target: new URL(location(res), url) };
  }
  const redeem = (code: string, verifier: string) => call("/v1/auth/app/token", { code, codeVerifier: verifier, ...mobile }, { origin: "capacitor://localhost" });

  it("signs up with Google, returns both cookies, persists the identity and reuses the same account", async () => {
    const response = await oauth("google", "?next=/account"); expect(location(response)).toBe("/account");
    expect(response.headers.getSetCookie()).toHaveLength(3); expect(jar.values.has("omb_oauth")).toBe(false);
    const first = await account();
    expect(first.account).toMatchObject({ email: "sid@openmausbot.test", name: "Sid Fixture", providers: ["email", "google"] });
    expect(first.identities).toEqual([{ provider: "google", email: "sid@openmausbot.test", label: "Sid Fixture", addedAt: time }]);
    jar = new CookieJar(); expect(location(await oauth("google"))).toBe("/");
    expect((await account()).account.id).toBe(first.account.id);
    restart({}); jar = new CookieJar(); await oauth("google"); expect((await account()).account.id).toBe(first.account.id);
  });
  it("links verified Google email to an existing email account without replacing its name", async () => {
    const signed = await (await emailLogin()).json() as WebSignInAnswer;
    await call("/v1/account", { name: "Chosen name" }, { [CSRF_HEADER]: signed.csrfToken }, "PATCH");
    jar = new CookieJar(); await oauth("google");
    expect((await account()).account).toMatchObject({ id: signed.account.id, name: "Chosen name", providers: ["email", "google"] });
  });
  it("does not link an unverified Google email", async () => {
    const signed = await (await emailLogin()).json() as WebSignInAnswer;
    fake.setUser("google", { subject: "unverified", email: signed.account.email, emailVerified: false, label: null, name: "Someone" });
    jar = new CookieJar();
    const target = new URL(location(await oauth("google", "?next=/account")), url);
    expect(target.pathname).toBe("/sign-in"); expect(target.searchParams.get("pending")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(target.searchParams.get("next")).toBe("/account"); expect((await call("/v1/me")).status).toBe(401);
    app.close(); expect(JSON.parse(readFileSync(`${dataDir}/auth.json`, "utf8")).identities).toEqual([]);
  });
  it("handles Apple form_post from Apple's origin, verifies its secret and saves the first name", async () => {
    const response = await oauth("apple"); expect(location(response)).toBe("/");
    const first = await account(); expect(first.account.name).toBe("Apple Fixture"); expect(first.identities[0]?.email).toBe("sid@privaterelay.appleid.test");
    jar = new CookieJar(); const auth = await authorization("apple"); expect(new URLSearchParams(auth.body).has("user")).toBe(false);
    await callback(auth); expect((await account()).account).toEqual(first.account);
    expect((await call("/v1/auth/start", { email: "someone@example.test" }, { origin: "https://appleid.apple.com" })).status).toBe(403);
    const badPost = await fetch(url + "/v1/auth/oauth/google/callback", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://appleid.apple.com" }, body: "state=bad" });
    expect(badPost.status).toBe(403);
  });
  it("rejects an Apple client secret signed with a different key", async () => {
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    restart({ oauth: { ...fake.config, apple: { ...fake.config.apple!, apple: { ...fake.config.apple!.apple!, privateKey: key } } } });
    expect(error(await oauth("apple"))).toBe("oauth_failed");
  });
  it("completes X without email through an email code, attaches once, and signs in directly next time", async () => {
    const target = new URL(location(await oauth("x", "?next=/account")), url), pending = target.searchParams.get("pending")!;
    const verified = await emailLogin("x-owner@example.test", pending); expect(verified.status).toBe(200);
    const signed = await verified.json() as WebSignInAnswer;
    expect(signed.redirect).toBe("/account"); expect(signed.account.providers).toEqual(["email", "x"]);
    expect((await account()).identities).toMatchObject([{ provider: "x", email: null, label: "sid_fixture" }]);
    expect((await call("/v1/auth/start", { email: "other@example.test", pending })).status).toBe(400);
    jar = new CookieJar(); expect(location(await oauth("x"))).toBe("/"); expect((await account()).account.id).toBe(signed.account.id);
  });
  it("finishes a pending identity only in the browser that signed in to the provider", async () => {
    const pending = new URL(location(await oauth("x")), url).searchParams.get("pending")!;
    // the pending link sent to someone else: their browser has no binding cookie, so it cannot attach the attacker's identity
    expect((await call("/v1/auth/start", { email: "victim@example.test", pending }, {}, "POST", new CookieJar())).status).toBe(400);
    const started = await call("/v1/auth/start", { email: "owner-x@example.test", pending }); expect(started.status).toBe(200);
    const { attempt } = await started.json() as { attempt: string };
    const code = /\b\d{8}\b/.exec(mailer.outbox.at(-1)!.text)![0];
    expect((await call("/v1/auth/verify", { attempt, code }, {}, "POST", new CookieJar())).status).toBe(410);
  });
  it("never links or creates by an X confirmed_email and supports a public client", async () => {
    const owner = await (await emailLogin("upper@example.test")).json() as WebSignInAnswer;
    jar = new CookieJar();
    fake.setUser("x", { subject: "x-email", email: "UPPER@example.test", label: "handle", name: "X Name" });
    delete fake.config.x!.clientSecret; restart({ oauth: fake.config });
    const target = new URL(location(await oauth("x")), url);
    expect(target.pathname).toBe("/sign-in"); expect(target.searchParams.get("pending")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await call("/v1/me")).status).toBe(401);
    expect(owner.account.providers).toEqual(["email"]);
  });
  it("links a Google address only where Google is authoritative (gmail or a workspace hd)", async () => {
    const victim = await (await emailLogin("person@company.test")).json() as WebSignInAnswer;
    jar = new CookieJar();
    // a former owner of person@company.test still holds a google account claiming it, verified, without hd
    fake.setUser("google", { subject: "stale-google", email: "person@company.test", emailVerified: true, label: null, name: "Former" });
    const target = new URL(location(await oauth("google")), url);
    expect(target.pathname).toBe("/sign-in"); expect(target.searchParams.get("pending")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await call("/v1/me")).status).toBe(401);
    jar = new CookieJar();
    fake.setUser("google", { subject: "workspace-google", email: "person@company.test", emailVerified: true, hd: "company.test", label: null, name: "Person" });
    expect(location(await oauth("google"))).toBe("/");
    expect((await account()).account.id).toBe(victim.account.id);
    jar = new CookieJar();
    fake.setUser("google", { subject: "gmail-google", email: "someone@gmail.com", emailVerified: true, label: null, name: "Someone" });
    expect(location(await oauth("google"))).toBe("/");
    expect((await account()).account.email).toBe("someone@gmail.com");
  });
  it.each(["google", "apple", "x"] as const)("maps %s denial and clears the binding", async provider => {
    fake.deny(provider); const response = await oauth(provider, "?next=/account");
    expect(error(response)).toBe("oauth_denied"); expect(new URL(location(response), url).searchParams.get("next")).toBe("/account");
    expect(jar.values.has("omb_oauth")).toBe(false);
  });
  it.each(["missing", "wrong"])("refuses a %s binding and consumes the state", async kind => {
    const auth = await authorization("google"), other = new CookieJar();
    if (kind === "wrong") other.values.set("omb_oauth", random());
    expect(error(await callback(auth, other))).toBe("oauth_failed"); expect(error(await callback(auth))).toBe("oauth_failed");
    expect((await call("/v1/me")).status).toBe(401);
  });
  it("refuses replay, mismatched providers, duplicate parameters, and expired state", async () => {
    const auth = await authorization("google"); await callback(auth); expect(error(await callback(auth))).toBe("oauth_failed");
    const mismatched = await authorization("google"); mismatched.callback = mismatched.callback.replace("/google/callback", "/x/callback"); expect(error(await callback(mismatched))).toBe("oauth_failed");
    const duplicate = await authorization("google"); duplicate.callback += "&code=other"; expect(error(await callback(duplicate))).toBe("oauth_failed");
    const expired = await authorization("google"); time += 600_000; expect(error(await callback(expired))).toBe("oauth_expired");
  });
  it.each(["//evil.example", "/a/..//evil.example", "https://evil.example", "/\\evil.example", "/a\nb", "/" + "a".repeat(512)])("falls back to / for next=%s", async next => {
    expect(location(await oauth("google", `?next=${encodeURIComponent(next)}`))).toBe("/");
  });
  it("encodes valid Unicode next paths for HTTP redirects", async () => {
    const next = "/account/नाम?q=hello world#profile";
    expect(location(await oauth("google", `?next=${encodeURIComponent(next)}`))).toBe(new URL(next, url).href.slice(url.length));
  });
  it("reuses a well-formed binding across starts and sets HTTPS cross-site cookie flags", async () => {
    const first = await call("/v1/auth/oauth/google/start"), binding = jar.values.get("omb_oauth");
    expect(first.headers.getSetCookie()[0]).toContain("HttpOnly; Path=/v1/auth; Max-Age=600; SameSite=Lax");
    await call("/v1/auth/oauth/x/start"); expect(jar.values.get("omb_oauth")).toBe(binding);
    restart({ publicUrl: "https://accounts.example.test" });
    const secure = await call("/v1/auth/oauth/apple/start"); expect(secure.headers.getSetCookie()[0]).toContain("SameSite=None; Secure");
  });
  it("attaches a second provider in link mode and keeps identity deletion working", async () => {
    await oauth("google"); const first = await account();
    await oauth("apple", "?link=1&next=/account"); const linked = await account();
    expect(linked.account.id).toBe(first.account.id); expect(linked.account.name).toBe("Sid Fixture"); expect(linked.identities.map(item => item.provider)).toEqual(["google", "apple"]);
    const deleted = await call("/v1/account/identities/apple", {}, { [CSRF_HEADER]: jar.values.get("omb_csrf")! }, "DELETE");
    expect(deleted.status).toBe(200); expect((await account()).identities).toHaveLength(1);
  });
  it("refuses linking without a session, after signout, or when another account owns the identity", async () => {
    expect(error(await call("/v1/auth/oauth/google/start?link=1"))).toBe("oauth_failed");
    await oauth("google"); const google = await account(); const ownerJar = jar;
    jar = new CookieJar(); await oauth("apple"); const apple = await account(); expect(apple.account.id).not.toBe(google.account.id);
    expect(error(await oauth("google", "?link=1"))).toBe("identity_taken"); expect((await account()).account.id).toBe(apple.account.id);
    jar = ownerJar; const auth = await authorization("apple", "?link=1"); await call("/v1/auth/signout", {});
    expect(error(await callback(auth))).toBe("oauth_failed");
  });
  it("refuses a pending identity that another email account claimed in the meantime", async () => {
    const first = new URL(location(await oauth("x")), url).searchParams.get("pending")!;
    const second = new URL(location(await oauth("x")), url).searchParams.get("pending")!;
    await emailLogin("first@example.test", first);
    const response = await emailLogin("second@example.test", second); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "identity_taken" });
    app.close(); expect(JSON.parse(readFileSync(`${dataDir}/auth.json`, "utf8")).accounts).toHaveLength(1);
  });
  it("expires pending identities and preserves closed-signup behavior", async () => {
    const pending = new URL(location(await oauth("x")), url).searchParams.get("pending")!;
    time += 900_000; expect((await call("/v1/auth/start", { email: "x@example.test", pending })).status).toBe(400);
    time = Date.now();
    const signed = await (await emailLogin()).json() as WebSignInAnswer;
    restart({ signupOpen: false }); jar = new CookieJar(); await oauth("google"); expect((await account()).account.id).toBe(signed.account.id);
    expect(error(await oauth("apple"))).toBe("signup_closed");
    const next = new URL(location(await oauth("x")), url).searchParams.get("pending")!;
    const start = await call("/v1/auth/start", { email: "new@example.test", pending: next }); expect(start.status).toBe(200);
    expect(mailer.outbox.some(message => message.to === "new@example.test")).toBe(false);
  });
  it("advertises configured providers and hides unavailable ones in production", async () => {
    expect(await (await call("/v1/auth/providers")).json()).toMatchObject({ providers: ["google", "apple", "x"].map(id => ({ id, enabled: true, comingSoon: false })) });
    restart({ oauth: {} }); expect(error(await call("/v1/auth/oauth/google/start?next=/account"))).toBe("provider_unavailable");
    expect(await (await call("/v1/auth/providers")).json()).toMatchObject({ providers: ["google", "apple", "x"].map(id => ({ id, enabled: false, comingSoon: true })) });
    restart({ dev: false }); expect(await (await call("/v1/auth/providers")).json()).toMatchObject({ providers: ["google", "apple", "x"].map(id => ({ id, enabled: false, comingSoon: false })) });
  });
  it("limits OAuth starts per IP across app and web routes", async () => {
    for (let i = 0; i < 60; i++) expect((await call("/v1/auth/oauth/google/start")).status).toBe(302);
    expect((await call("/v1/auth/oauth/x/start")).status).toBe(429);
    expect((await call("/v1/auth/app/start")).status).toBe(429);
  });
  it("exchanges an app deep-link code for an accepted mobile omc_ grant, without cookies", async () => {
    const flow = await appAuthorization();
    expect(flow.target.protocol).toBe("openmausbot:"); expect(flow.target.hostname).toBe("auth"); expect(flow.target.searchParams.get("state")).toBe(flow.state);
    const code = flow.target.searchParams.get("code")!; expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(jar.values.has("omb_dash")).toBe(false);
    const response = await redeem(code, flow.verifier); expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toBeNull(); expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const grant = await response.json() as AppGrant; expect(grant.accessToken).toMatch(/^omc_[A-Za-z0-9_-]{43}$/);
    const session = await call("/api/cloud/desktop/session", undefined, { authorization: `Bearer ${grant.accessToken}` }); expect(session.status).toBe(200); expect(await session.json()).toMatchObject({ account: grant.account, device: grant.device });
    expect(await (await redeem(code, flow.verifier)).json()).toEqual({ error: "invalid_grant" });
    app.close(); const saved = readFileSync(`${dataDir}/auth.json`, "utf8"); expect(saved).not.toContain(code); expect(saved).not.toContain(flow.verifier); expect(JSON.parse(saved).sessions[0].kind).toBe("mobile");
  });
  it("burns app codes on wrong or malformed verifiers and rejects expired codes", async () => {
    for (const wrong of [random(), "bad"]) {
      const flow = await appAuthorization(), code = flow.target.searchParams.get("code")!;
      expect(await (await redeem(code, wrong)).json()).toEqual({ error: "invalid_grant" });
      expect(await (await redeem(code, flow.verifier)).json()).toEqual({ error: "invalid_grant" });
    }
    const flow = await appAuthorization(); time += 300_000; expect(await (await redeem(flow.target.searchParams.get("code")!, flow.verifier)).json()).toEqual({ error: "invalid_grant" });
    const malformed = await fetch(url + "/v1/auth/app/token", { method: "POST", body: "{" }); expect(malformed.status).toBe(400); expect(await malformed.json()).toEqual({ error: "invalid_grant" });
  });
  it("completes the app's pending email and returns a fresh PKCE deep link", async () => {
    const flow = await appAuthorization("x"); expect(flow.target.pathname).toBe("/sign-in");
    const signed = await (await emailLogin("phone@example.test", flow.target.searchParams.get("pending")!)).json() as WebSignInAnswer;
    const deep = new URL(signed.redirect!); expect(deep.protocol).toBe("openmausbot:"); expect(deep.searchParams.get("state")).toBe(flow.state);
    expect((await redeem(deep.searchParams.get("code")!, flow.verifier)).status).toBe(200);
  });
  it("returns app errors to the exact deep link with its state", async () => {
    fake.deny("google"); const flow = await appAuthorization();
    expect(flow.target.protocol).toBe("openmausbot:"); expect(flow.target.searchParams.get("error")).toBe("oauth_denied"); expect(flow.target.searchParams.get("state")).toBe(flow.state);
  });
  it.each([
    { provider: "missing" }, { provider: "email" }, { code_challenge: "bad" }, { code_challenge_method: "plain" }, { state: "short" }, { state: "x".repeat(257) }, { redirect_uri: "https://evil.example" }, { redirect_uri: "openmausbot://auth/" }, { link: "1" },
  ])("rejects invalid app authorization parameters %j", async change => {
    const params = new URLSearchParams({ provider: "google", code_challenge: random(), code_challenge_method: "S256", state: random(), redirect_uri: APP_AUTH_REDIRECT });
    for (const [key, value] of Object.entries(change)) if (value !== undefined) params.set(key, value);
    const response = await call(`/v1/auth/app/start?${params}`); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "invalid_request" });
  });
  it("rejects forged or invalid id tokens before creating an account", async () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let mutation: Record<string, unknown> = {}, header: Record<string, unknown> = {}, badSignature = false;
    const request: typeof fetch = async (input, init) => {
      const response = await fetch(input, init), path = new URL(String(input)).pathname;
      if (path === "/google/jwks") return Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "fixture-rsa", alg: "RS256" }] });
      if (path !== "/google/token") return response;
      const tokens = await response.json() as { id_token: string }, parts = tokens.id_token.split(".");
      const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
      const data = [ { alg: "RS256", kid: "fixture-rsa", ...header }, { ...claims, ...mutation } ].map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
      return Response.json({ id_token: `${data}.${(badSignature ? Buffer.alloc(256) : sign("sha256", Buffer.from(data), keys.privateKey)).toString("base64url")}` });
    };
    restart({ fetch: request });
    for (const changes of [{ aud: "other" }, { iss: "other" }, { nonce: "other" }, { exp: Math.floor(time / 1000) - 61 }]) { mutation = changes; expect(error(await oauth("google"))).toBe("oauth_failed"); }
    mutation = {}; header = { alg: "none" }; expect(error(await oauth("google"))).toBe("oauth_failed");
    header = { kid: "unknown" }; expect(error(await oauth("google"))).toBe("oauth_failed");
    header = {}; badSignature = true; expect(error(await oauth("google"))).toBe("oauth_failed");
    expect((await call("/v1/me")).status).toBe(401); app.close(); expect(JSON.parse(readFileSync(`${dataDir}/auth.json`, "utf8")).accounts).toEqual([]);
  });
});

describe("provider environment configuration", () => {
  it("loads production defaults, optional X auth and escaped Apple PEM without env URL overrides", () => {
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const env = { OMB_AUTH_GOOGLE_CLIENT_ID: "google", OMB_AUTH_GOOGLE_CLIENT_SECRET: "secret", OMB_AUTH_GOOGLE_TOKEN_URL: "https://evil.example", OMB_AUTH_X_CLIENT_ID: "x", OMB_AUTH_X_SCOPES: "users.read offline.access", OMB_AUTH_APPLE_CLIENT_ID: "apple", OMB_AUTH_APPLE_TEAM_ID: "team", OMB_AUTH_APPLE_KEY_ID: "key", OMB_AUTH_APPLE_PRIVATE_KEY: key.replace(/\n/g, "\\n") };
    const config = providersFromEnv(env);
    expect(config.google).toMatchObject({ tokenUrl: "https://oauth2.googleapis.com/token", scopes: "openid email profile" });
    expect(config.x).toMatchObject({ clientId: "x", scopes: "users.read offline.access" }); expect(config.x?.clientSecret).toBeUndefined();
    expect(config.apple?.apple?.privateKey).toBe(key); expect(config.apple?.authorizeUrl).toBe("https://appleid.apple.com/auth/authorize");
    const dir = mkdtempSync(join(tmpdir(), "omb-apple-key-"));
    try {
      const file = join(dir, "key.p8"); writeFileSync(file, key, { mode: 0o600 });
      expect(providersFromEnv({ ...env, OMB_AUTH_APPLE_PRIVATE_KEY: undefined, OMB_AUTH_APPLE_PRIVATE_KEY_FILE: file }).apple?.apple?.privateKey).toBe(key);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    expect(providersFromEnv({})).toEqual({});
  });
  it.each([
    [{ OMB_AUTH_GOOGLE_CLIENT_ID: "client" }, "OMB_AUTH_GOOGLE_CLIENT_SECRET"],
    [{ OMB_AUTH_GOOGLE_CLIENT_SECRET: "secret" }, "OMB_AUTH_GOOGLE_CLIENT_ID"],
    [{ OMB_AUTH_X_CLIENT_SECRET: "secret" }, "OMB_AUTH_X_CLIENT_ID"],
    [{ OMB_AUTH_APPLE_CLIENT_ID: "client" }, "OMB_AUTH_APPLE_TEAM_ID"],
    [{ OMB_AUTH_APPLE_CLIENT_ID: "client", OMB_AUTH_APPLE_TEAM_ID: "team" }, "OMB_AUTH_APPLE_KEY_ID"],
    [{ OMB_AUTH_APPLE_CLIENT_ID: "client", OMB_AUTH_APPLE_TEAM_ID: "team", OMB_AUTH_APPLE_KEY_ID: "key" }, "OMB_AUTH_APPLE_PRIVATE_KEY"],
  ])("names missing configuration without values", (env, name) => { expect(() => providersFromEnv(env)).toThrow(name); });
});
