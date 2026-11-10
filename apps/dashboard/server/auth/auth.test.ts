import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardApp, type DashboardAppOptions } from "../app.ts";
import { memoryMailer } from "./mail.ts";
import { createCloudAccountClient } from "../../../../electron/cloud-account.mjs";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, type AccountAnswer, type AppGrant, type EmailStartAnswer, type EnrollGrantAnswer, type WebSignInAnswer } from "../../../../shared/account-api.ts";
import { SIGNATURE_HEADERS, SIGNATURE_SKEW_MS, signedPayload, type EnrollAnswer, type WorkspaceDetail } from "../../../../shared/dashboard-protocol.ts";

const day = 86_400_000;
const device = { deviceName: "Fixture Mac", platform: "darwin", appVersion: "1.2.3" };
const email = "owner@example.test";
type Browser = WebSignInAnswer & { cookie: string };
type Authorization = { deviceCode: string; userCode: string; interval: number; expiresIn: number; verificationUri: string; verificationUriComplete: string };
async function body<T>(response: Response | Promise<Response>): Promise<T> { return (await response).json() as Promise<T>; }

describe("local account service", () => {
  let dataDir: string, url: string, time: number, server: Server;
  let app: ReturnType<typeof createDashboardApp>;
  let mailer: ReturnType<typeof memoryMailer>;
  let options: DashboardAppOptions;
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "omb-auth-test-"));
    time = Date.now(); mailer = memoryMailer();
    options = { dataDir, publicUrl: "http://127.0.0.1:7480", mailer, staticDir: null, now: () => time };
    app = createDashboardApp(options);
    server = createServer(app.handle);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not start.");
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    app.close();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  function restart(changes: Partial<DashboardAppOptions> = {}) {
    app.close(); options = { ...options, ...changes }; app = createDashboardApp(options);
    server.removeAllListeners("request"); server.on("request", app.handle);
  }
  function call(path: string, data?: unknown, headers: Record<string, string> = {}, method = data === undefined ? "GET" : "POST") {
    return fetch(url + path, { method, headers: { ...(data === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  }
  const code = (address = email) => mailer.outbox.findLast(item => item.to === address)!.text.match(/\b\d{8}\b/)![0];
  const browserHeaders = (browser: Browser) => ({ cookie: browser.cookie, [CSRF_HEADER]: browser.csrfToken });
  const bearer = (grant: AppGrant) => ({ authorization: `Bearer ${grant.accessToken}` });
  async function start(address = email, appSignIn = false, headers = {}) {
    const response = await call(appSignIn ? "/api/cloud/app/sign-in/start" : "/v1/auth/start", { email: address, ...(appSignIn ? device : {}) }, headers);
    expect(response.status).toBe(200);
    return body<EmailStartAnswer>(response);
  }
  async function login(address = email): Promise<Browser> {
    const { attempt } = await start(address);
    const response = await call("/v1/auth/verify", { attempt, code: code(address) });
    expect(response.status).toBe(200);
    return { ...await body<WebSignInAnswer>(response), cookie: response.headers.getSetCookie()[0]!.split(";")[0]! };
  }
  async function appLogin(address = email): Promise<AppGrant> {
    const { attempt } = await start(address, true);
    const response = await call("/api/cloud/app/sign-in/verify", { attempt, code: code(address) });
    expect(response.status).toBe(200);
    return body<AppGrant>(response);
  }
  const authorize = () => body<Authorization>(call("/api/cloud/desktop/authorize", device));
  const poll = (authorization: Authorization) => call("/api/cloud/desktop/token", { deviceCode: authorization.deviceCode });
  function enrollment(enrollToken?: string, settings: { bad?: boolean; at?: number; keys?: { publicKey: KeyObject; privateKey: KeyObject } } = {}) {
    const keys = settings.keys ?? generateKeyPairSync("ed25519");
    const input = { v: 1, publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"), name: "Fixture", kind: "mac", version: "1.0.0", ...(enrollToken === undefined ? {} : { enrollToken }) };
    const raw = JSON.stringify(input), at = settings.at ?? time;
    const signature = sign(null, Buffer.from(signedPayload("POST", "/v1/enroll", at, createHash("sha256").update(raw).digest("hex"))), keys.privateKey).toString("base64");
    return { keys, input, headers: { [SIGNATURE_HEADERS.time]: String(at), [SIGNATURE_HEADERS.signature]: settings.bad ? Buffer.alloc(64).toString("base64") : signature } };
  }

  it("creates a normalized email account, signs in again and exposes only contract views", async () => {
    const started = await start(" OWNER@EXAMPLE.TEST ");
    expect(started).toMatchObject({ expiresIn: 600, resendAfter: 30, signupOpen: true });
    expect(started.attempt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mailer.outbox[0]).toMatchObject({ to: email, subject: "Your Dusk Bot code" });
    expect(mailer.outbox[0].text).toContain("It expires in 10 minutes.");
    expect(mailer.outbox[0].html).toContain(code());
    const first = await body<WebSignInAnswer>(call("/v1/auth/verify", { attempt: started.attempt, code: code() }));
    expect(first.created).toBe(true);
    expect(first.account).toEqual({ id: expect.stringMatching(/^acct_/), email, name: null, createdAt: time, providers: ["email"] });
    time += 30_000;
    const second = await login();
    expect(second.created).toBe(false);
    expect(second.account.id).toBe(first.account.id);
    expect(await body(call("/v1/me", undefined, browserHeaders(second)))).toEqual({ account: second.account, csrfToken: second.csrfToken });
    const view = await body<AccountAnswer>(call("/v1/account", undefined, browserHeaders(second)));
    expect(view.identities).toEqual([]);
    expect(view.sessions).toHaveLength(2);
    expect(view.sessions[0]).toMatchObject({ current: true, kind: "web", name: "Browser", platform: null, appVersion: null });
    expect(view.sessions[0]).not.toHaveProperty("tokenHash");
    expect(view.sessions[0]).not.toHaveProperty("accountId");
    expect(await body(call("/v1/me"))).toMatchObject({ code: "signed_out" });
    expect((await call("/v1/account")).status).toBe(401);
    expect(await body(call("/v1/auth/start", { email: "bad" }))).toMatchObject({ code: "invalid_email" });
    expect(await body(call("/v1/auth/start", { email, pending: "unknown" }))).toMatchObject({ code: "invalid_request" });
  });

  it("limits each code to five wrong guesses, expires attempts and consumes successful codes", async () => {
    const { attempt } = await start();
    const wrong = code() === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < 5; i++) expect(await body(call("/v1/auth/verify", { attempt, code: wrong }))).toMatchObject({ code: "wrong_code" });
    const expired = await call("/v1/auth/verify", { attempt, code: code() });
    expect(expired.status).toBe(410);
    time += 30_000;
    const next = await start(); time += 600_000;
    expect((await call("/v1/auth/verify", { attempt: next.attempt, code: code() })).status).toBe(410);
    const current = await start();
    expect((await call("/v1/auth/verify", { attempt: current.attempt, code: code() })).status).toBe(200);
    expect((await call("/v1/auth/verify", { attempt: current.attempt, code: code() })).status).toBe(410);
  });

  it("shares resend, email and IP limits across web and app sign-in", async () => {
    await start();
    expect((await call("/api/cloud/app/sign-in/start", { email, ...device })).status).toBe(429);
    time += 30_000;
    for (let i = 0; i < 4; i++) { await start(email, true); time += 30_000; }
    expect(await body(call("/v1/auth/start", { email }))).toMatchObject({ code: "rate_limited" });
    time += 3_600_000;
    for (let i = 0; i < 20; i++) await start(`ip${i}@example.test`, i % 2 === 0);
    const response = await call("/api/cloud/app/sign-in/start", { email: "over@example.test", ...device });
    expect(response.status).toBe(429); expect(await response.json()).toEqual({ error: "rate_limited" });
    time += 3_600_000;
    expect((await call("/v1/auth/start", { email })).status).toBe(200);
  });

  it("limits verifies per IP and trusts forwarded IPs only when configured", async () => {
    for (let i = 0; i < 60; i++) expect((await call("/v1/auth/verify", { attempt: "missing", code: "12345678" })).status).toBe(410);
    expect((await call("/api/cloud/app/sign-in/verify", { attempt: "missing", code: "12345678" }, { "x-forwarded-for": "192.0.2.2" })).status).toBe(429);
    restart({ trustProxy: true });
    // the proxy appends the address it saw; whatever the client put first must not pick a fresh bucket
    for (let i = 0; i < 20; i++) await start(`proxy${i}@example.test`, false, { "x-forwarded-for": `198.51.100.${i}, 192.0.2.2` });
    expect((await call("/v1/auth/start", { email: "full@example.test" }, { "x-forwarded-for": "198.51.100.99, 192.0.2.2" })).status).toBe(429);
    expect((await call("/v1/auth/start", { email: "fresh@example.test" }, { "x-forwarded-for": "192.0.2.2, 192.0.2.1" })).status).toBe(200);
  });

  it("hides unknown accounts when signups close and allows existing accounts to sign in", async () => {
    const existing = await login(); time += 30_000;
    restart({ signupOpen: false });
    const known = await start(email, true), unknown = await start("new@example.test", true);
    expect({ ...unknown, attempt: "opaque" }).toEqual({ ...known, attempt: "opaque" });
    expect(unknown.signupOpen).toBe(false);
    expect(mailer.outbox.filter(item => item.to === "new@example.test")).toHaveLength(0);
    const denied = await call("/api/cloud/app/sign-in/verify", { attempt: unknown.attempt, code: "12345678" });
    // no code was sent, so a guess is just a wrong code: nothing says whether the address has an account
    expect(denied.status).toBe(400); expect(await denied.json()).toEqual({ error: "invalid_code" });
    expect((await body<AppGrant>(call("/api/cloud/app/sign-in/verify", { attempt: known.attempt, code: code() }))).account.id).toBe(existing.account.id);
    const web = await start("web-new@example.test");
    expect(await body(call("/v1/auth/verify", { attempt: web.attempt, code: "12345678" }))).toMatchObject({ code: "wrong_code" });
  });

  it.each([false, true])("sets both cookie flags and expires web sessions, https=%s", async secure => {
    restart({ publicUrl: `${secure ? "https" : "http"}://localhost:7480` });
    const { attempt } = await start();
    const response = await call("/v1/auth/verify", { attempt, code: code() });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain(`${SESSION_COOKIE}=`); expect(cookies[0]).toContain("HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000");
    expect(cookies[1]).toContain(`${CSRF_COOKIE}=`); expect(cookies[1]).toContain("SameSite=Strict; Path=/; Max-Age=2592000"); expect(cookies[1]).not.toContain("HttpOnly");
    for (const cookie of cookies) expect(cookie.includes("; Secure")).toBe(secure);
    const result = await body<WebSignInAnswer>(response);
    expect(cookies[1]).toContain(`=${result.csrfToken};`);
    const headers = { cookie: cookies[0].split(";")[0] };
    time += 30 * day;
    expect((await call("/v1/me", undefined, headers)).status).toBe(401);
  });

  it("requires CSRF for account, claim, workspace and command mutations", async () => {
    const browser = await login(), headers = browserHeaders(browser);
    const { input } = enrollment();
    const enrolled = await body<EnrollAnswer>(call("/v1/enroll", input));
    const claim = { token: enrolled.claimUrl.split("#")[1] };
    for (const csrf of [undefined, "bad", "a".repeat(43)]) {
      const response = await call("/v1/claim", claim, { cookie: browser.cookie, ...(csrf ? { [CSRF_HEADER]: csrf } : {}) });
      expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "csrf" });
    }
    expect((await call("/v1/claim", claim, headers)).status).toBe(200);
    const paths = [
      ["PATCH", "/v1/account", { name: " Owner " }], ["PATCH", `/v1/workspaces/${enrolled.workspaceId}`, { name: "New name" }],
      ["POST", `/v1/workspaces/${enrolled.workspaceId}/commands`, { kind: "computer.wake", target: "bot" }],
      ["DELETE", "/v1/account/identities/google", {}], ["DELETE", "/v1/account/sessions/missing", {}],
      ["POST", "/v1/account/signout-everywhere", {}], ["POST", "/v1/account/delete", { email }],
      ["DELETE", `/v1/workspaces/${enrolled.workspaceId}`, {}],
    ] as const;
    for (const [method, path, input] of paths) expect(await body(call(path, input, { cookie: browser.cookie }, method))).toMatchObject({ code: "csrf" });
    for (const [method, path, input] of paths.slice(0, 3)) expect((await call(path, input, headers, method)).status).toBe(200);
    expect((await body<AccountAnswer>(call("/v1/account", undefined, headers))).account.name).toBe("Owner");
    for (const name of ["", " ", "x".repeat(81), "a\nb", 1]) expect((await call("/v1/account", { name }, headers, "PATCH")).status).toBe(400);
    expect((await body<AccountAnswer>(call("/v1/account", { name: null }, headers, "PATCH"))).account.name).toBeNull();
    expect((await call(`/v1/workspaces/${enrolled.workspaceId}`, {}, headers, "DELETE")).status).toBe(200);
  });

  it("issues app grants for desktop and mobile, validates inputs and keeps web attempts separate", async () => {
    for (const invalid of [{ deviceName: "" }, { deviceName: "a\nb" }, { deviceName: "a".repeat(101) }, { platform: "other" }, { appVersion: "1/2" }, { appVersion: "" }, { email: "bad" }]) {
      const response = await call("/api/cloud/app/sign-in/start", { email, ...device, ...invalid });
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    const started = await start(email, true);
    expect((await call("/v1/auth/verify", { attempt: started.attempt, code: code() })).status).toBe(400);
    const wrong = code() === "00000000" ? "11111111" : "00000000";
    expect(await body(call("/api/cloud/app/sign-in/verify", { attempt: started.attempt, code: wrong }))).toEqual({ error: "invalid_code" });
    const grant = await body<AppGrant>(call("/api/cloud/app/sign-in/verify", { attempt: started.attempt, code: code() }));
    expect(grant).toEqual({ cloudContractVersion: 1, accessToken: expect.stringMatching(/^omc_[A-Za-z0-9_-]{43}$/), expiresAt: time + 90 * day, device: { id: expect.stringMatching(/^ses_/) }, account: { id: expect.stringMatching(/^acct_/), email } });
    const session = await call("/api/cloud/desktop/session", undefined, bearer(grant));
    expect(await session.json()).toMatchObject({ cloudContractVersion: 1, expiresAt: grant.expiresAt, device: grant.device, account: grant.account, entitlement: { plan: "free", status: "inactive", expiresAt: null, version: 0 } });
    expect(session.headers.get("set-cookie")).toBeNull();
    for (const platform of ["ios", "android", "win32", "linux"]) {
      time += 30_000;
      const attempt = await body<EmailStartAnswer>(call("/api/cloud/app/sign-in/start", { email, ...device, platform }));
      expect((await call("/api/cloud/app/sign-in/verify", { attempt: attempt.attempt, code: code() })).status).toBe(200);
    }
    time += 30_000;
    const browser = await login();
    const sessions = (await body<AccountAnswer>(call("/v1/account", undefined, browserHeaders(browser)))).sessions;
    expect(sessions.filter(item => item.kind === "mobile").map(item => item.platform).sort()).toEqual(["android", "ios"]);
    expect(sessions.find(item => item.id === grant.device.id)).toMatchObject({ kind: "desktop", name: device.deviceName, platform: device.platform, appVersion: device.appVersion });
    expect((await call("/v1/me", undefined, { cookie: `${SESSION_COOKIE}=${grant.accessToken}` })).status).toBe(401);
    expect((await call("/api/cloud/desktop/session", undefined, { authorization: `Bearer omc_${browser.cookie.split("=")[1]}` })).status).toBe(401);
  });

  it("renews app sessions within 30 days, throttles last-seen writes and rejects expired or revoked tokens", async () => {
    const grant = await appLogin();
    time += 20_000;
    await call("/api/cloud/desktop/session", undefined, bearer(grant)); app.close();
    const saved = () => JSON.parse(readFileSync(`${dataDir}/auth.json`, "utf8")) as { sessions: Array<{ lastSeenAt: number; expiresAt: number }> };
    expect(saved().sessions[0].lastSeenAt).toBe(time - 20_000);
    restart(); time += 40_000;
    await call("/api/cloud/desktop/session", undefined, bearer(grant)); app.close();
    expect(saved().sessions[0].lastSeenAt).toBe(time);
    restart(); time += 61 * day;
    expect(await body(call("/api/cloud/desktop/session", undefined, bearer(grant)))).toMatchObject({ expiresAt: time + 90 * day });
    expect((await call("/api/cloud/desktop/session", {}, bearer(grant), "DELETE")).status).toBe(200);
    for (const method of ["GET", "DELETE"]) {
      const response = await call("/api/cloud/desktop/session", method === "GET" ? undefined : {}, bearer(grant), method);
      expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "invalid_token" });
    }
    const expired = await appLogin(); time += 90 * day;
    expect(await body(call("/api/cloud/desktop/session", undefined, bearer(expired)))).toEqual({ error: "invalid_token" });
  });

  it("allows only specified app CORS routes and formats malformed app requests as Admin errors", async () => {
    for (const path of ["/api/cloud/app/sign-in/start", "/api/cloud/app/sign-in/verify", "/api/cloud/desktop/session", "/v1/app/enroll-grant", "/v1/auth/app/token"]) {
      const response = await call(path, undefined, { origin: "capacitor://localhost", "access-control-request-method": "POST" }, "OPTIONS");
      expect(response.status).toBe(204); expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-headers")).toBe("content-type, authorization, x-dusk-version");
      expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, DELETE, OPTIONS");
      expect(response.headers.get("access-control-allow-credentials")).toBeNull(); expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect((await call("/v1/auth/providers", undefined, {}, "OPTIONS")).headers.get("access-control-allow-origin")).toBeNull();
    const started = await call("/api/cloud/app/sign-in/start", { email, ...device }, { origin: "capacitor://localhost" });
    expect(started.status).toBe(200); expect(started.headers.get("access-control-allow-origin")).toBe("*");
    const malformed = await fetch(url + "/api/cloud/app/sign-in/start", { method: "POST", body: "{" });
    expect(malformed.status).toBe(400); expect(await malformed.json()).toEqual({ error: "invalid_request" });
    expect((await call("/v1/auth/start", { email }, { origin: "https://other.test" })).status).toBe(403);
    const failed = await call("/api/cloud/desktop/session");
    expect(failed.headers.get("access-control-allow-origin")).toBe("*");
    expect(failed.headers.get("cache-control")).toBe("no-store");
  });

  it("supports desktop pending, slowdown, lookup, approval and a one-time grant", async () => {
    const browser = await login(), authorization = await authorize();
    expect(authorization.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.userCode).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(authorization).toMatchObject({ cloudContractVersion: 1, expiresIn: 900, interval: 5, verificationUri: `${options.publicUrl}/cloud/desktop`, verificationUriComplete: `${options.publicUrl}/cloud/desktop?code=${authorization.userCode}` });
    expect(await body(poll(authorization))).toEqual({ error: "authorization_pending" });
    expect(await body(poll(authorization))).toEqual({ error: "slow_down", interval: 10 });
    expect((await call(`/v1/auth/device?code=${authorization.userCode}`)).status).toBe(401);
    expect(await body(call(`/v1/auth/device?code=${authorization.userCode}`, undefined, browserHeaders(browser)))).toEqual({ device: { name: device.deviceName, platform: "darwin" }, userCode: authorization.userCode, expiresAt: time + 900_000 });
    expect((await call("/v1/auth/device?code=unknown", undefined, browserHeaders(browser))).status).toBe(404);
    expect((await call("/v1/auth/device/approve", { userCode: authorization.userCode }, { cookie: browser.cookie })).status).toBe(403);
    expect((await call("/v1/auth/device/approve", { userCode: authorization.userCode }, browserHeaders(browser))).status).toBe(200);
    expect((await call("/v1/auth/device/approve", { userCode: authorization.userCode }, browserHeaders(browser))).status).toBe(404);
    time += 10_000;
    const grant = await body<AppGrant>(poll(authorization));
    expect(grant.account.id).toBe(browser.account.id);
    expect(grant.accessToken).toMatch(/^omc_[A-Za-z0-9_-]{43}$/);
    expect((await call("/api/cloud/desktop/session", undefined, bearer(grant))).status).toBe(200);
    expect(await body(poll(authorization))).toEqual({ error: "invalid_grant" });
  });

  it("denies and expires authorizations, validates devices and limits authorization requests", async () => {
    const browser = await login(), authorization = await authorize();
    expect((await call("/v1/auth/device/deny", { userCode: authorization.userCode }, { cookie: browser.cookie })).status).toBe(403);
    expect((await call("/v1/auth/device/deny", { userCode: authorization.userCode }, browserHeaders(browser))).status).toBe(200);
    expect(await body(poll(authorization))).toEqual({ error: "access_denied" });
    const expired = await authorize(); time += 900_000;
    expect(await body(poll(expired))).toEqual({ error: "expired_token" });
    expect((await call(`/v1/auth/device?code=${expired.userCode}`, undefined, browserHeaders(browser))).status).toBe(404);
    expect(await body(call("/api/cloud/desktop/authorize", { deviceName: "bad", platform: "other" }))).toEqual({ error: "invalid_request" });
    for (let i = 0; i < 28; i++) expect((await call("/api/cloud/desktop/authorize", { deviceName: "Valid", platform: "linux" })).status).toBe(200);
    expect((await call("/api/cloud/desktop/authorize", device)).status).toBe(429);
  });

  it("lists sessions newest first and revokes only owned sessions", async () => {
    const grant = await appLogin(); time += 30_000;
    const browser = await login(); time += 30_000;
    const other = await login("other@example.test");
    const view = await body<AccountAnswer>(call("/v1/account", undefined, browserHeaders(browser)));
    expect(view.sessions.map(item => item.kind)).toEqual(["web", "desktop"]);
    expect(view.sessions.map(item => item.current)).toEqual([true, false]);
    expect((await call(`/v1/account/sessions/${grant.device.id}`, {}, browserHeaders(other), "DELETE")).status).toBe(404);
    expect((await call(`/v1/account/sessions/${grant.device.id}`, {}, browserHeaders(browser), "DELETE")).status).toBe(200);
    expect((await call("/api/cloud/desktop/session", undefined, bearer(grant))).status).toBe(401);
    expect((await call("/v1/me", undefined, browserHeaders(browser))).status).toBe(200);
    const response = await call("/v1/auth/signout", {}, { cookie: browser.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().every(cookie => cookie.includes("Max-Age=0"))).toBe(true);
    expect((await call("/v1/me", undefined, browserHeaders(browser))).status).toBe(401);
    expect((await call("/v1/me", undefined, browserHeaders(other))).status).toBe(200);
    expect((await call("/v1/auth/signout", {})).status).toBe(200);
  });

  it("signs out every web and app session and removes pending approvals", async () => {
    const grant = await appLogin(); time += 30_000;
    const browser = await login(); time += 30_000;
    const second = await login();
    const authorization = await authorize();
    await call("/v1/auth/device/approve", { userCode: authorization.userCode }, browserHeaders(browser));
    const response = await call("/v1/account/signout-everywhere", {}, browserHeaders(browser));
    expect(response.status).toBe(200); expect(response.headers.getSetCookie()).toHaveLength(2);
    for (const session of [browser, second]) expect((await call("/v1/me", undefined, browserHeaders(session))).status).toBe(401);
    expect((await call("/api/cloud/desktop/session", undefined, bearer(grant))).status).toBe(401);
    expect(await body(poll(authorization))).toEqual({ error: "invalid_grant" });
  });

  it("extends session data while keeping identity fields authoritative", async () => {
    const grant = await appLogin();
    app.auth.extendSession(id => ({ account: { id: "spoofed" }, cloudContractVersion: 99, expiresAt: 0, device: {}, teams: [id], entitlement: { plan: "pro", status: "active", expiresAt: time + day, version: 1 } }));
    app.auth.extendSession(async () => ({ cloud: { id: "cloud_fixture" } }));
    expect(await body(call("/api/cloud/desktop/session", undefined, bearer(grant)))).toMatchObject({ cloudContractVersion: 1, account: grant.account, device: grant.device, expiresAt: grant.expiresAt,
      teams: [grant.account.id], cloud: { id: "cloud_fixture" }, entitlement: { plan: "pro", status: "active", expiresAt: time + day, version: 1 } });
  });

  it("enrolls with a signed grant, reassigns ownership and refuses bad, stale, replayed and reused grants", async () => {
    const grant = await appLogin();
    expect((await call("/v1/app/enroll-grant", {})).status).toBe(401);
    const enrollGrant = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(grant)));
    expect(enrollGrant).toEqual({ v: 1, enrollToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: time + 600_000, dashboardUrl: options.publicUrl });
    const request = enrollment(enrollGrant.enrollToken);
    expect((await call("/v1/enroll", request.input)).status).toBe(401);
    expect((await call("/v1/enroll", request.input, { ...request.headers, [SIGNATURE_HEADERS.signature]: Buffer.alloc(64).toString("base64") })).status).toBe(401);
    const stale = enrollment(enrollGrant.enrollToken, { keys: request.keys, at: time - SIGNATURE_SKEW_MS - 1 });
    expect(await body(call("/v1/enroll", stale.input, stale.headers))).toMatchObject({ code: "stale_time" });
    const enrolled = await body<EnrollAnswer>(call("/v1/enroll", request.input, request.headers));
    expect(enrolled.claimExpiresAt).toBe(0); expect(enrolled.claimUrl).toBe(`${options.publicUrl}/?workspace=${enrolled.workspaceId}`);
    expect(await body(call("/v1/enroll", request.input, request.headers))).toMatchObject({ code: "replay" });
    const used = enrollment(enrollGrant.enrollToken, { keys: request.keys, at: ++time });
    expect((await call("/v1/enroll", used.input, used.headers)).status).toBe(403);
    time += 30_000;
    const owner = await login();
    expect(await body(call("/v1/workspaces", undefined, browserHeaders(owner)))).toMatchObject({ workspaces: [{ id: enrolled.workspaceId }] });
    const next = await appLogin("other@example.test");
    const nextGrant = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(next)));
    const move = enrollment(nextGrant.enrollToken, { keys: request.keys });
    expect((await body<EnrollAnswer>(call("/v1/enroll", move.input, move.headers))).workspaceId).toBe(enrolled.workspaceId);
    expect(await body(call("/v1/workspaces", undefined, browserHeaders(owner)))).toEqual({ workspaces: [] });
    time += 30_000;
    const nextOwner = await login("other@example.test");
    expect(await body(call("/v1/workspaces", undefined, browserHeaders(nextOwner)))).toMatchObject({ workspaces: [{ id: enrolled.workspaceId }] });
    const expires = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(next)));
    time += 600_000;
    expect(app.auth.consumeEnrollGrant(expires.enrollToken)).toBeNull();
    expect((await call("/v1/enroll", { ...request.input, enrollToken: "bad" })).status).toBe(400);
    app.close();
    const saved = JSON.parse(readFileSync(`${dataDir}/state.json`, "utf8"));
    expect(saved.workspaces[0].claimHash).toBeNull();
  });

  it("ends grants with their app session and drops the previous owner's queued commands on a move", async () => {
    const first = await appLogin();
    const firstGrant = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(first)));
    const request = enrollment(firstGrant.enrollToken);
    const enrolled = await body<EnrollAnswer>(call("/v1/enroll", request.input, request.headers));
    time += 30_000;
    const owner = await login();
    expect((await call(`/v1/workspaces/${enrolled.workspaceId}/commands`, { kind: "routine.resume", target: "r1" }, browserHeaders(owner))).status).toBe(200);
    time += 30_000;
    const next = await appLogin("other@example.test");
    const revoked = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(next)));
    const kept = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(next)));
    time += 30_000;
    const later = await appLogin("other@example.test");
    expect((await call("/api/cloud/desktop/session", {}, bearer(next), "DELETE")).status).toBe(200);
    // the session that asked for the grant is gone, so neither of its grants enrolls anything
    const stale = enrollment(revoked.enrollToken, { keys: request.keys, at: ++time });
    expect((await call("/v1/enroll", stale.input, stale.headers)).status).toBe(403);
    expect(app.auth.consumeEnrollGrant(kept.enrollToken)).toBeNull();
    const fresh = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(later)));
    const move = enrollment(fresh.enrollToken, { keys: request.keys, at: ++time });
    expect((await call("/v1/enroll", move.input, move.headers)).status).toBe(200);
    time += 30_000;
    const nextOwner = await login("other@example.test");
    expect(await body<WorkspaceDetail>(call(`/v1/workspaces/${enrolled.workspaceId}`, undefined, browserHeaders(nextOwner)))).toMatchObject({ commands: [] });
  });

  it("answers closed-signup starts before mail goes out, so timing never shows an account exists", async () => {
    await login(); time += 30_000;
    restart({ signupOpen: false, mailer: { send: () => new Promise<void>(() => {}) } });
    const known = await call("/v1/auth/start", { email });
    expect(known.status).toBe(200);
    restart({ signupOpen: false, mailer: { send: async () => { throw new Error("down"); } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    time += 30_000;
    expect((await call("/v1/auth/start", { email })).status).toBe(200);
    expect((await call("/v1/auth/start", { email: "nobody@example.test" })).status).toBe(200);
  });

  it("recovers a sign-in by email: the code, a one-time website link and the ways in, the same answer for no account", async () => {
    const first = await login(); time += 30_000;
    const recovered = await body<EmailStartAnswer>(call("/v1/auth/start", { email, recover: true }));
    const mail = mailer.outbox.at(-1)!;
    expect(mail).toMatchObject({ to: email, subject: "Sign in to Dusk Bot" });
    expect(mail.text).toContain("This account signs in with an emailed code.");
    const link = new URL(/Or open this link to sign in: (\S+)/.exec(mail.text)![1]!), secret = new URLSearchParams(link.hash.slice(1));
    // in the fragment: never sent to a server, so never in a log
    expect(`${link.origin}${link.pathname}${link.search}`).toBe("http://127.0.0.1:7480/sign-in");
    expect(secret.get("attempt")).toBe(recovered.attempt);
    const signedIn = await call("/v1/auth/verify", { attempt: secret.get("attempt"), code: secret.get("code") });
    expect(signedIn.status).toBe(200); expect((await body<WebSignInAnswer>(signedIn)).account.id).toBe(first.account.id);
    expect((await call("/v1/auth/verify", { attempt: secret.get("attempt"), code: secret.get("code") })).status).toBe(410);
    // the app gets the code alone: a link would sign in the browser, not this computer
    time += 30_000;
    const app = await body<EmailStartAnswer>(call("/api/cloud/app/sign-in/start", { email, ...device, recover: true }));
    expect(mailer.outbox.at(-1)!.text).not.toContain("http");
    const grant = await call("/api/cloud/app/sign-in/verify", { attempt: app.attempt, code: code() });
    expect((await body<AppGrant>(grant)).account.id).toBe(first.account.id);
    // no account: the same answer, a mail that says so, and no code that could create one
    const sent = mailer.outbox.length;
    const nobody = await call("/v1/auth/start", { email: "nobody@example.test", recover: true });
    expect(nobody.status).toBe(200); expect(Object.keys(await nobody.json() as object).sort()).toEqual(Object.keys(recovered as object).sort());
    expect(mailer.outbox).toHaveLength(sent + 1);
    expect(mailer.outbox.at(-1)!.text).toContain("no Dusk Bot account uses it"); expect(mailer.outbox.at(-1)!.text).not.toMatch(/\b\d{8}\b/);
    for (const bad of [{ email, recover: "yes" }, { email, recover: false }]) expect((await call("/v1/auth/start", bad)).status).toBe(400);
  });

  it("answers recovery before mail goes out and keeps the resend limit", async () => {
    await login(); time += 30_000;
    restart({ mailer: { send: () => new Promise<void>(() => {}) } });
    expect((await call("/v1/auth/start", { email, recover: true })).status).toBe(200);
    expect((await call("/v1/auth/start", { email, recover: true })).status).toBe(429);
  });

  it("deletes accounts, identities, sessions, attempts, grants and owned workspaces, awaiting hooks", async () => {
    const grant = await appLogin(); time += 30_000;
    const browser = await login();
    const enrollGrant = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(grant)));
    const request = enrollment(enrollGrant.enrollToken);
    await call("/v1/enroll", request.input, request.headers);
    const leftover = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(grant)));
    const authorization = await authorize();
    await call("/v1/auth/device/approve", { userCode: authorization.userCode }, browserHeaders(browser));
    time += 30_000; const attempt = await start();
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    let hookDone = false;
    app.auth.onAccountDeleted(async id => { expect(id).toBe(browser.account.id); await new Promise(resolve => setTimeout(resolve, 5)); hookDone = true; });
    app.auth.onAccountDeleted(() => { throw new Error("sensitive fixture detail"); });
    expect((await call("/v1/account/delete", { email: "mismatch@example.test" }, browserHeaders(browser))).status).toBe(400);
    const response = await call("/v1/account/delete", { email }, browserHeaders(browser));
    expect(response.status).toBe(200); expect(hookDone).toBe(true);
    expect(logs).toHaveBeenCalledWith("Account deletion cleanup failed.");
    expect(response.headers.getSetCookie().every(cookie => cookie.includes("Max-Age=0"))).toBe(true);
    expect(app.auth.account(browser.account.id)).toBeNull();
    expect(app.auth.consumeEnrollGrant(leftover.enrollToken)).toBeNull();
    expect((await call("/v1/me", undefined, browserHeaders(browser))).status).toBe(401);
    expect((await call("/api/cloud/desktop/session", undefined, bearer(grant))).status).toBe(401);
    expect((await call("/v1/auth/verify", { attempt: attempt.attempt, code: code() })).status).toBe(410);
    expect(await body(poll(authorization))).toEqual({ error: "invalid_grant" });
    app.close();
    expect(JSON.parse(readFileSync(`${dataDir}/auth.json`, "utf8"))).toEqual({ accounts: [], identities: [], sessions: [] });
    expect(JSON.parse(readFileSync(`${dataDir}/state.json`, "utf8"))).toEqual({ accounts: [], sessions: [], workspaces: [] });
  });

  it("removes a linked identity while retaining email and does not expose provider subjects", async () => {
    const browser = await login();
    app.close();
    const path = `${dataDir}/auth.json`, saved = JSON.parse(readFileSync(path, "utf8"));
    saved.identities.push({ accountId: browser.account.id, provider: "google", subject: "private-subject", email, label: "Fixture", addedAt: time });
    writeFileSync(path, JSON.stringify(saved));
    app = createDashboardApp(options); server.removeAllListeners("request"); server.on("request", app.handle);
    const linked = await body<AccountAnswer>(call("/v1/account", undefined, browserHeaders(browser)));
    expect(linked.account.providers).toEqual(["email", "google"]);
    expect(linked.identities).toEqual([{ provider: "google", email, label: "Fixture", addedAt: time }]);
    const removed = await body<AccountAnswer>(call("/v1/account/identities/google", {}, browserHeaders(browser), "DELETE"));
    expect(removed.identities).toEqual([]); expect(removed.account.providers).toEqual(["email"]);
    expect((await call("/v1/account/identities/google", {}, browserHeaders(browser), "DELETE")).status).toBe(404);
  });

  it("persists only hashes with private permissions and reuses the generated secret across restarts", async () => {
    const grant = await appLogin(); time += 30_000;
    const browser = await login();
    const enroll = await body<EnrollGrantAnswer>(call("/v1/app/enroll-grant", {}, bearer(grant)));
    const authorization = await authorize();
    app.close();
    const saved = readFileSync(`${dataDir}/auth.json`, "utf8");
    for (const value of [grant.accessToken, browser.cookie.split("=")[1]!, browser.csrfToken, enroll.enrollToken, authorization.deviceCode, ...mailer.outbox.map(item => item.text.match(/\b\d{8}\b/)![0])]) expect(saved).not.toContain(value);
    expect(JSON.parse(saved).sessions.every((item: { tokenHash: string }) => /^[a-f0-9]{64}$/.test(item.tokenHash))).toBe(true);
    expect(statSync(`${dataDir}/auth.json`).mode & 0o777).toBe(0o600);
    expect(statSync(`${dataDir}/auth-secret`).mode & 0o777).toBe(0o600);
    const secret = readFileSync(`${dataDir}/auth-secret`, "utf8");
    restart();
    expect(readFileSync(`${dataDir}/auth-secret`, "utf8")).toBe(secret);
    expect(await body(call("/v1/me", undefined, browserHeaders(browser)))).toMatchObject({ csrfToken: browser.csrfToken });
    expect((await call("/v1/account", { name: "After restart" }, browserHeaders(browser), "PATCH")).status).toBe(200);
    expect((await call("/api/cloud/desktop/session", undefined, bearer(grant))).status).toBe(200);
    expect(app.auth.consumeEnrollGrant(enroll.enrollToken)).toBeNull();
  });

  it("reuses a legacy account id and clears old proxy sessions", async () => {
    app.close();
    const path = `${dataDir}/state.json`;
    writeFileSync(path, JSON.stringify({ accounts: [{ id: "legacy_account", email }], sessions: [{ hash: "old", accountId: "legacy_account", expiresAt: time + day }], workspaces: [] }));
    app = createDashboardApp(options); server.removeAllListeners("request"); server.on("request", app.handle);
    const browser = await login();
    expect(browser.account.id).toBe("legacy_account");
    app.close(); expect(JSON.parse(readFileSync(path, "utf8")).sessions).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8")).accounts).toEqual([{ id: "legacy_account", email }]);
  });

  it("advertises an empty provider registry, with coming soon only in development", async () => {
    expect(await body(call("/v1/auth/providers"))).toEqual({ v: 1, signupOpen: true, recovery: true, providers: ["google", "apple", "x"].map(id => ({ id, enabled: false, comingSoon: true })) });
    restart({ dev: false });
    expect(await body(call("/v1/auth/providers"))).toEqual({ v: 1, signupOpen: true, recovery: true, providers: ["google", "apple", "x"].map(id => ({ id, enabled: false, comingSoon: false })) });
  });

  it("works with the desktop client's email flow, browser flow, identity parser and revoke", async () => {
    restart({ publicUrl: url });
    const browser = await login(); time += 30_000;
    let saved: unknown = null, tick: (() => void) | undefined;
    const opened: string[] = [];
    const settings = { origin: url, fixture: true, ...device, now: () => time,
      store: { async read() { return saved; }, async write(value: unknown) { saved = value; } },
      async openBrowser(target: string) { opened.push(target); },
      setTimer(callback: () => void) { tick = callback; return 1; }, clearTimer() { tick = undefined; } };
    const client = createCloudAccountClient(settings);
    try {
      expect((await client.start()).status).toBe("signed-out");
      expect((await client.emailStart(email)).outcome).toBe("sent");
      expect((await client.emailVerify(code() === "00000000" ? "11111111" : "00000000")).outcome).toBe("wrong-code");
      expect((await client.emailVerify(code())).outcome).toBe("signed-in");
      expect(client.state()).toMatchObject({ status: "connected", account: { id: browser.account.id, email }, entitlement: { plan: "free", status: "inactive" } });
      const token = (saved as { token: string }).token;
      expect((await client.signOut()).status).toBe("signed-out");
      expect((await call("/api/cloud/desktop/session", undefined, { authorization: `Bearer ${token}` })).status).toBe(401);
      expect((await client.begin()).status).toBe("connecting");
      expect(opened[0]).toBe(`${url}/cloud/desktop?code=${client.state().enrollment!.userCode}`);
      await call("/v1/auth/device/approve", { userCode: client.state().enrollment!.userCode }, browserHeaders(browser));
      time += 5000; tick!();
      await vi.waitFor(() => expect(client.state().status).toBe("connected"));
      expect((await client.signOut()).status).toBe("signed-out");
    } finally { client.close(); }
  });

  it("fails mail delivery generically without exposing mailer errors", async () => {
    restart({ mailer: { async send() { throw new Error("private provider details"); } } });
    const response = await call("/v1/auth/start", { email });
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "Request failed.", code: "failed" });
  });
});
