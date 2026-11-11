import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ACCOUNT_ROUTES as R, APP_AUTH_REDIRECT, CSRF_COOKIE, CSRF_HEADER, EMAIL_CODE_TRIES, EMAIL_CODE_TTL_SECONDS, EMAIL_RESEND_SECONDS, OAUTH_PROVIDERS, SESSION_COOKIE } from "../../../../shared/account-api.ts";
import type { AccountAnswer, AccountErrorCode, AccountView, AppGrant, AppSessionIdentity, OAuthErrorCode, OAuthProvider } from "../../../../shared/account-api.ts";
import { createAuthStore } from "./store.ts";
import type { Account, Session } from "./store.ts";
import { codeMessage, recoveryMessage } from "./mail.ts";
import type { Mailer } from "./mail.ts";
import { createProviderRegistry, type ProviderConfigs, type ProviderProfile } from "./providers.ts";
import { clientIp } from "../client-ip.ts";

export interface AuthOptions {
  dataDir: string; publicUrl: string; mailer: Mailer; now?: () => number; fetch?: typeof fetch;
  /** where the page is served on publicUrl ("/app" when it shares the origin with the site, "" at the root) */
  pageBase?: string;
  /** sign-in emails the service sends an hour across everyone (DUSK_AUTH_MAIL_PER_HOUR, default 300) */
  mailPerHour?: number;
  oauth?: ProviderConfigs;
  dev: boolean; signupOpen: boolean; trustProxy: boolean; legacyAccounts?: () => Array<{ id: string; email: string }>;
}
export class AuthError extends Error {
  status: number;
  code: AccountErrorCode;
  fields: Record<string, unknown>;
  constructor(status: number, code: AccountErrorCode, fields: Record<string, unknown> = {}) {
    super(messages[code] ?? "Request failed."); this.status = status; this.code = code; this.fields = fields;
  }
}
const messages: Partial<Record<AccountErrorCode, string>> = {
  billing_active: "Cancel your plan and Dusk Cloud before deleting your account.",
  invalid_request: "Invalid request.", invalid_email: "Enter a valid email address.", wrong_code: "Code is incorrect.", invalid_code: "Code is incorrect.",
  expired: "Sign-in has expired.", rate_limited: "Try again later.", signup_closed: "New accounts are not available.", signed_out: "Sign in to continue.",
  csrf: "Refresh the page and try again.", not_found: "Not found.", invalid_token: "Session is invalid.", invalid_grant: "Grant is invalid.",
};
const day = 86_400_000, hour = 3_600_000;
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const controls = (value: string) => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const label = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max && !controls(value);
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && !controls(email) && /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ? email : null;
}
export function isAppCorsRoute(path: string) {
  return path.startsWith("/api/cloud/app/sign-in/") || [R.appSession, R.enrollGrant, R.appToken].some(route => route === path);
}
interface DeviceInfo { name: string; platform: string; appVersion: string | null }
interface Attempt { email: string; codeHash: string; pending?: string; device: DeviceInfo | null; expiresAt: number; tries: number }
interface DeviceAuthorization { userCode: string; device: DeviceInfo; expiresAt: number; interval: number; lastPollAt: number | null; accountId: string | null; denied: boolean }
interface AppFlow { challenge: string; state: string; expiresAt: number }
interface OAuthState { provider: OAuthProvider; nonce: string; verifier: string; bindingHash: string; next: string; linkAccount: string | null; linkSession: string | null; appFlow?: string; expiresAt: number }
interface PendingIdentity { provider: OAuthProvider; profile: ProviderProfile; next: string; appFlow?: string; bindingHash: string; expiresAt: number }
interface BodyHelpers { readBody(req: IncomingMessage): Promise<Buffer>; bodyObject(body: Buffer): Record<string, unknown> }

export function createAuth(options: AuthOptions) {
  const now = options.now ?? Date.now;
  const publicUrl = new URL(options.publicUrl).origin, pageBase = options.pageBase ?? "", pages = `${publicUrl}${pageBase}`;
  const store = createAuthStore(options.dataDir), state = store.state;
  const providers = createProviderRegistry(options.oauth, { fetch: options.fetch, now });
  const oauthStates = new Map<string, OAuthState>();
  const pendingIdentities = new Map<string, PendingIdentity>();
  const appFlows = new Map<string, AppFlow>();
  const appCodes = new Map<string, { challenge: string; accountId: string; expiresAt: number }>();
  const attempts = new Map<string, Attempt>();
  const devices = new Map<string, DeviceAuthorization>();
  const expiredDevices = new Map<string, number>();
  const grants = new Map<string, { accountId: string; sessionId: string; expiresAt: number }>();
  const limits = new Map<string, { count: number; until: number }>();
  const sentAt = new Map<string, number>();
  const extensions: Array<(accountId: string) => Promise<Record<string, unknown>> | Record<string, unknown>> = [];
  const beforeDeleteHooks: Array<(owner: Account, body: Record<string, unknown>) => void | Promise<void>> = [];
  const deletedHooks: Array<(accountId: string) => void | Promise<void>> = [];
  const signedInHooks: Array<(account: Account) => void> = [];
  const hmac = (value: string) => createHmac("sha256", store.secret).update(value).digest("base64url");
  const csrfFor = (session: Session) => hmac(session.tokenHash);
  const fail = (status: number, code: AccountErrorCode, fields?: Record<string, unknown>): never => { throw new AuthError(status, code, fields); };
  const account = (id: string) => state.accounts.find(item => item.id === id) ?? null;
  function sweep() {
    const time = now();
    for (const [key, item] of oauthStates) if (item.expiresAt + 600_000 <= time) oauthStates.delete(key);
    for (const [key, item] of pendingIdentities) if (item.expiresAt <= time) pendingIdentities.delete(key);
    for (const [key, item] of appFlows) if (item.expiresAt + 900_000 <= time) appFlows.delete(key);
    for (const [key, item] of appCodes) if (item.expiresAt <= time) appCodes.delete(key);
    for (const [key, item] of attempts) if (item.expiresAt <= time) attempts.delete(key);
    for (const [key, item] of grants) if (item.expiresAt <= time) grants.delete(key);
    for (const [key, item] of devices) if (item.expiresAt <= time) { expiredDevices.set(key, item.expiresAt + hour); devices.delete(key); }
    for (const [key, until] of expiredDevices) if (until <= time) expiredDevices.delete(key);
    for (const [key, item] of limits) if (item.until <= time) limits.delete(key);
    for (const [key, timeSent] of sentAt) if (timeSent + EMAIL_RESEND_SECONDS * 1000 <= time) sentAt.delete(key);
    const sessions = state.sessions.filter(item => item.expiresAt > time);
    if (sessions.length !== state.sessions.length) { state.sessions = sessions; store.changed(); }
  }
  const timer = setInterval(sweep, 60_000);
  timer.unref();
  const ip = (req: IncomingMessage) => clientIp(req, options.trustProxy);
  function rate(key: string, max: number) {
    const item = limits.get(key) ?? { count: 0, until: now() + hour };
    limits.set(key, item);
    if (++item.count > max) fail(429, "rate_limited");
  }
  function lookup(token: string, web: boolean) {
    sweep();
    const session = state.sessions.find(item => item.tokenHash === hash(token) && (item.kind === "web") === web);
    const owner = session && account(session.accountId);
    return session && owner ? { account: owner, session } : null;
  }
  function webSession(req: IncomingMessage) {
    const token = req.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    return opaque(token) ? lookup(token, true) : null;
  }
  function requireWeb(req: IncomingMessage, { mutation }: { mutation: boolean }) {
    const found = webSession(req);
    if (!found) return fail(401, "signed_out");
    if (mutation) {
      const csrf = req.headers[CSRF_HEADER];
      if (typeof csrf !== "string" || !opaque(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(csrfFor(found.session)))) fail(403, "csrf");
    }
    return found.account;
  }
  function appSession(req: IncomingMessage) {
    const bearer = req.headers.authorization;
    if (!bearer || !/^Bearer omc_[A-Za-z0-9_-]{43}$/.test(bearer)) return null;
    const found = lookup(bearer.slice(7), false);
    if (!found) return null;
    let changed = false;
    if (now() - found.session.lastSeenAt >= 60_000) { found.session.lastSeenAt = now(); changed = true; }
    if (found.session.expiresAt - now() < 30 * day) { found.session.expiresAt = now() + 90 * day; changed = true; }
    if (changed) store.changed();
    return found;
  }
  function view(owner: Account): AccountView {
    return { ...owner, providers: ["email", ...OAUTH_PROVIDERS.filter(provider => state.identities.some(item => item.accountId === owner.id && item.provider === provider))] };
  }
  function accountAnswer(owner: Account, current: string | undefined): AccountAnswer {
    return { account: view(owner), identities: state.identities.filter(item => item.accountId === owner.id).map(({ provider, email, label, addedAt }) => ({ provider, email, label, addedAt })),
      sessions: state.sessions.filter(item => item.accountId === owner.id).sort((a, b) => b.createdAt - a.createdAt).map(({ id, kind, name, platform, appVersion, createdAt, lastSeenAt, expiresAt }) =>
        ({ id, kind, name, platform, appVersion, createdAt, lastSeenAt, expiresAt, current: id === current })) };
  }
  function cookies(res: ServerResponse, token = "", csrf = "") {
    const flags = `Path=/; Max-Age=${token ? 30 * day / 1000 : 0}${publicUrl.startsWith("https:") ? "; Secure" : ""}`;
    res.setHeader("set-cookie", [`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; ${flags}`, `${CSRF_COOKIE}=${csrf}; SameSite=Strict; ${flags}`]);
  }
  function makeSession(owner: Account, device: DeviceInfo | null) {
    const token = `${device ? "omc_" : ""}${random()}`;
    const session: Session = { id: `ses_${randomBytes(16).toString("base64url")}`, accountId: owner.id, tokenHash: hash(token),
      kind: device ? ["ios", "android"].includes(device.platform) ? "mobile" : "desktop" : "web", name: device?.name ?? "Browser",
      platform: device?.platform ?? null, appVersion: device?.appVersion ?? null, createdAt: now(), lastSeenAt: now(), expiresAt: now() + (device ? 90 : 30) * day };
    state.sessions.push(session);
    store.changed();
    return { token, session };
  }
  function identity(owner: Account, session: Session): AppSessionIdentity {
    return { cloudContractVersion: 1, expiresAt: session.expiresAt, device: { id: session.id }, account: { id: owner.id, email: owner.email } };
  }
  function appGrant(owner: Account, device: DeviceInfo): AppGrant {
    const { token, session } = makeSession(owner, device);
    return { ...identity(owner, session), accessToken: token };
  }
  function deviceInfo(data: Record<string, unknown>, versionRequired: boolean): DeviceInfo {
    if (!label(data.deviceName, 100) || (data.deviceName as string).length > 100 || typeof data.platform !== "string" || !["darwin", "win32", "linux", "ios", "android"].includes(data.platform)
      || ((versionRequired || data.appVersion !== undefined) && (typeof data.appVersion !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(data.appVersion)))) return fail(400, "invalid_request");
    return { name: data.deviceName, platform: data.platform, appVersion: typeof data.appVersion === "string" ? data.appVersion : null };
  }
  async function start(req: IncomingMessage, data: Record<string, unknown>, app: boolean) {
    const email = cleanEmail(data.email);
    if (!email) return fail(400, app ? "invalid_request" : "invalid_email");
    if (data.pending !== undefined && (app || !opaque(data.pending) || !pendingFor(req, data.pending))) fail(400, "invalid_request");
    if (data.recover !== undefined && (data.recover !== true || data.pending !== undefined)) fail(400, "invalid_request");
    const device = app ? deviceInfo(data, true) : null;
    rate(`start:${ip(req)}`, 20);
    rate(`email:${email}`, 6);
    // every address and caller together: one botnet spread over many addresses cannot burn the mail quota or our sender reputation
    rate("mail:all", options.mailPerHour ?? 300);
    if (sentAt.has(email)) fail(429, "rate_limited");
    sentAt.set(email, now());
    const attempt = random(), code = randomInt(0, 100_000_000).toString().padStart(8, "0");
    const item: Attempt = { email, ...(typeof data.pending === "string" ? { pending: data.pending } : {}), codeHash: hmac(`${attempt}:${code}`), device, expiresAt: now() + EMAIL_CODE_TTL_SECONDS * 1000, tries: 0 };
    attempts.set(hash(attempt), item);
    if (data.recover === true) {
      // can't sign in: the code, a one-time link for the website, and the ways this address signs in; for no account, only
      // that. answered before delivery, the same either way, so the answer never tells whether the address has an account
      const owner = state.accounts.find(item => item.email === email);
      const link = owner && !app ? `${pages}/sign-in#${new URLSearchParams({ attempt, code })}` : null;
      void options.mailer.send(recoveryMessage(email, { code, link, ways: owner ? view(owner).providers : null })).catch(() => console.error("Email delivery failed."));
    } else if (options.signupOpen) {
      try { await options.mailer.send(codeMessage(email, code)); } catch { attempts.delete(hash(attempt)); fail(502, "failed"); }
    } else if (state.accounts.some(item => item.email === email)) {
      // signups closed: answer before delivery so timing and mail failures never tell whether the address has an account
      void options.mailer.send(codeMessage(email, code)).catch(() => console.error("Email delivery failed."));
    }
    return { ...(app ? { cloudContractVersion: 1 } : {}), attempt, expiresIn: EMAIL_CODE_TTL_SECONDS, resendAfter: EMAIL_RESEND_SECONDS, signupOpen: options.signupOpen };
  }
  function verifyEmail(req: IncomingMessage, res: ServerResponse, data: Record<string, unknown>, app: boolean) {
    rate(`verify:${ip(req)}`, 60);
    const key = opaque(data.attempt) ? hash(data.attempt) : "";
    const attempt = attempts.get(key);
    if (!attempt || attempt.expiresAt <= now()) return fail(410, "expired");
    if (!!attempt.device !== app) return fail(400, "invalid_request");
    let owner = state.accounts.find(item => item.email === attempt.email);
    const supplied = hmac(`${data.attempt}:${typeof data.code === "string" ? data.code : ""}`);
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(attempt.codeHash))) {
      if (++attempt.tries >= EMAIL_CODE_TRIES) attempts.delete(key);
      return fail(400, app ? "invalid_code" : "wrong_code");
    }
    attempts.delete(key);
    if (!owner && !options.signupOpen) return fail(403, "signup_closed");
    // a pending identity finishes only in the browser that signed in to the provider, never through a link sent to someone else
    const pending = attempt.pending ? pendingFor(req, attempt.pending) : undefined;
    if (attempt.pending && (!pending || pending.expiresAt <= now())) return fail(410, "expired");
    if (pending?.appFlow && !activeFlow(pending.appFlow)) return fail(410, "expired");
    if (pending) {
      const existing = linkedIdentity(pending.provider, pending.profile.subject);
      if (existing && existing.accountId !== owner?.id) return fail(409, "identity_taken");
    }
    const created = !owner;
    if (!owner) {
      const legacy = options.legacyAccounts?.().find(item => cleanEmail(item.email) === attempt.email);
      owner = { id: legacy?.id ?? `acct_${randomBytes(16).toString("base64url")}`, email: attempt.email, name: null, createdAt: now() };
      state.accounts.push(owner);
      store.changed();
    }
    let redirect: string | undefined;
    if (pending && attempt.pending) {
      pendingIdentities.delete(attempt.pending);
      attach(owner, pending.provider, pending.profile);
      redirect = pending.appFlow ? appRedirect(pending.appFlow, owner) : pending.next;
    }
    for (const hook of signedInHooks) hook(owner);
    if (attempt.device) return appGrant(owner, attempt.device);
    const { token, session } = makeSession(owner, null), csrfToken = csrfFor(session);
    cookies(res, token, csrfToken);
    return { account: view(owner), csrfToken, created, ...(redirect ? { redirect } : {}) };
  }
  const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
  function nextPath(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || controls(value) || value.length > 512) return "/";
    const target = new URL(value, publicUrl);
    if (target.origin !== publicUrl || target.pathname.startsWith("//")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  }
  const linkedIdentity = (provider: OAuthProvider, subject: string) => state.identities.find(item => item.provider === provider && item.subject === subject);
  function attach(owner: Account, provider: OAuthProvider, profile: ProviderProfile) {
    const existing = linkedIdentity(provider, profile.subject);
    if (existing && existing.accountId !== owner.id) return fail(409, "identity_taken");
    if (!existing) state.identities.push({ accountId: owner.id, provider, subject: profile.subject, email: profile.email, label: profile.label, addedAt: now() });
    if (provider !== "x" && owner.name === null && profile.name) owner.name = profile.name;
    store.changed();
  }
  function pendingFor(req: IncomingMessage, id: string) {
    const item = pendingIdentities.get(id), cookie = binding(req);
    return item && opaque(cookie) && equal(hash(cookie), item.bindingHash) ? item : undefined;
  }
  function binding(req: IncomingMessage) {
    return req.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith("omb_oauth="))?.slice(10);
  }
  function oauthCookie(res: ServerResponse, value = "") {
    const secure = publicUrl.startsWith("https:");
    res.appendHeader("set-cookie", `omb_oauth=${value}; HttpOnly; Path=/v1/auth; Max-Age=${value ? 600 : 0}; SameSite=${secure ? "None; Secure" : "Lax"}`);
  }
  function redirect(res: ServerResponse, location: string) { res.writeHead(302, { location, "referrer-policy": "no-referrer" }); res.end(); }
  function oauthError(res: ServerResponse, code: OAuthErrorCode, next = "/", flowId?: string) {
    const flow = flowId ? appFlows.get(flowId) : undefined;
    if (flowId) appFlows.delete(flowId);
    const query = new URLSearchParams({ error: code, ...(flow ? { state: flow.state } : { next }) });
    oauthCookie(res);
    redirect(res, `${flow ? APP_AUTH_REDIRECT : `${pageBase}/sign-in`}?${query}`);
  }
  function activeFlow(id: string) { const flow = appFlows.get(id); return flow && flow.expiresAt > now() ? flow : null; }
  function appRedirect(id: string, owner: Account) {
    const flow = activeFlow(id);
    if (!flow) return fail(410, "expired");
    appFlows.delete(id);
    const code = random();
    appCodes.set(hash(code), { challenge: flow.challenge, accountId: owner.id, expiresAt: now() + 300_000 });
    return `${APP_AUTH_REDIRECT}?${new URLSearchParams({ code, state: flow.state })}`;
  }
  function oauthStart(req: IncomingMessage, res: ServerResponse, url: URL, id: string, flowId?: string) {
    const next = nextPath(url.searchParams.get("next")), provider = providers.get(id as OAuthProvider);
    if (!provider) return oauthError(res, "provider_unavailable", next, flowId);
    const link = url.searchParams.get("link") === "1" ? webSession(req) : null;
    if (url.searchParams.get("link") === "1" && !link) return oauthError(res, "oauth_failed", next, flowId);
    const existing = binding(req), cookie = opaque(existing) ? existing : random();
    const key = random(), nonce = random(), verifier = id === "apple" ? "" : random();
    oauthStates.set(hash(key), { provider: provider.id, nonce, verifier, bindingHash: hash(cookie), next, linkAccount: link?.account.id ?? null,
      linkSession: link?.session.id ?? null, ...(flowId ? { appFlow: flowId } : {}), expiresAt: now() + 600_000 });
    oauthCookie(res, cookie);
    redirect(res, provider.authorize({ state: key, nonce, verifier, redirectUri: `${publicUrl}${R.oauthCallback(provider.id)}` }));
  }
  async function oauthCallback(req: IncomingMessage, res: ServerResponse, url: URL, id: string, helpers: BodyHelpers) {
    let item: OAuthState | undefined;
    try {
      let params = url.searchParams;
      if (id === "apple" && req.method === "POST") {
        if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") throw new Error();
        const raw = await helpers.readBody(req);
        if (raw.length > 65_536 || url.search) throw new Error();
        params = new URLSearchParams(raw.toString("utf8"));
      }
      const key = params.get("state"), stored = opaque(key) ? oauthStates.get(hash(key)) : undefined;
      if (opaque(key)) oauthStates.delete(hash(key));
      if (!stored || stored.provider !== id) throw new Error();
      item = stored;
      const cookie = binding(req);
      if (!opaque(cookie) || !equal(hash(cookie), item.bindingHash)) throw new Error();
      if (item.expiresAt <= now() || (item.appFlow && !activeFlow(item.appFlow))) return oauthError(res, "oauth_expired", item.next, item.appFlow);
      if (req.method !== (id === "apple" ? "POST" : "GET") || [...params.keys()].some(key => params.getAll(key).length !== 1)) throw new Error();
      if (params.get("error") === "access_denied") return oauthError(res, "oauth_denied", item.next, item.appFlow);
      const code = params.get("code"), provider = providers.get(item.provider);
      if (params.has("error") || !code || code.length > 4096 || controls(code) || !provider) throw new Error();
      const profile = await provider.profile({ code, nonce: item.nonce, verifier: item.verifier, redirectUri: `${publicUrl}${R.oauthCallback(item.provider)}`, user: params.get("user") ?? undefined });
      if (item.expiresAt <= now() || (item.appFlow && !activeFlow(item.appFlow))) return oauthError(res, "oauth_expired", item.next, item.appFlow);
      const existing = linkedIdentity(item.provider, profile.subject);
      let owner: Account | null | undefined;
      if (item.linkAccount) {
        owner = account(item.linkAccount);
        if (!owner || !state.sessions.some(session => session.id === item!.linkSession && session.accountId === owner!.id && session.expiresAt > now())) throw new Error();
        if (existing && existing.accountId !== owner.id) return oauthError(res, "identity_taken", item.next, item.appFlow);
      } else if (existing) { owner = account(existing.accountId); if (!owner) throw new Error(); }
      else if (profile.email) owner = state.accounts.find(owner => owner.email === profile.email);
      if (!owner && !profile.email) {
        const pending = random();
        pendingIdentities.set(pending, { provider: item.provider, profile, next: item.next, appFlow: item.appFlow, bindingHash: item.bindingHash, expiresAt: now() + 600_000 });
        oauthCookie(res, cookie);
        return redirect(res, `${pageBase}/sign-in?${new URLSearchParams({ pending, next: item.next })}`);
      }
      if (!owner) {
        if (!options.signupOpen) return oauthError(res, "signup_closed", item.next, item.appFlow);
        const legacy = options.legacyAccounts?.().find(owner => cleanEmail(owner.email) === profile.email);
        owner = { id: legacy?.id ?? `acct_${randomBytes(16).toString("base64url")}`, email: profile.email!, name: null, createdAt: now() };
        state.accounts.push(owner);
      }
      attach(owner, item.provider, profile);
      for (const hook of signedInHooks) hook(owner);
      if (item.appFlow) { const location = appRedirect(item.appFlow, owner); oauthCookie(res); return redirect(res, location); }
      const { token, session } = makeSession(owner, null);
      cookies(res, token, csrfFor(session)); oauthCookie(res);
      redirect(res, `${pageBase}${item.next}`);
    } catch { oauthError(res, "oauth_failed", item?.next, item?.appFlow); }
  }
  function removeSessions(accountId: string) {
    state.sessions = state.sessions.filter(item => item.accountId !== accountId);
    for (const [key, code] of appCodes) if (code.accountId === accountId) appCodes.delete(key);
    for (const [key, item] of oauthStates) if (item.linkAccount === accountId) oauthStates.delete(key);
    for (const [key, device] of devices) if (device.accountId === accountId) devices.delete(key);
    store.changed();
  }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, helpers: BodyHelpers): Promise<boolean> {
    const path = url.pathname, method = req.method ?? "GET", cors = isAppCorsRoute(path);
    const routes: string[] = [R.providers, R.emailStart, R.emailVerify, R.signOut, R.me, R.account, R.signOutEverywhere, R.deleteAccount, R.deviceLookup, R.deviceApprove, R.deviceDeny,
      R.appEmailStart, R.appEmailVerify, R.desktopAuthorize, R.desktopToken, R.appSession, R.enrollGrant, R.appToken, R.appStart];
    if (!routes.includes(path) && !path.startsWith("/v1/auth/oauth/") && !path.startsWith("/v1/account/identities/") && !path.startsWith("/v1/account/sessions/") && !cors) return false;
    res.setHeader("cache-control", "no-store");
    if (cors) {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "content-type, authorization, x-dusk-version");
      res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
      if (method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
    }
    function json(value: unknown, status = 200) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); }
    try {
      sweep();
      const oauth = /^\/v1\/auth\/oauth\/([^/]+)\/(start|callback)$/.exec(path);
      if (oauth?.[2] === "callback") { await oauthCallback(req, res, url, oauth[1]!, helpers); return true; }
      if (method === "GET" && oauth?.[2] === "start") {
        rate(`oauth:${ip(req)}`, 60); oauthStart(req, res, url, oauth[1]!); return true;
      }
      if (method === "GET" && path === R.appStart) {
        rate(`oauth:${ip(req)}`, 60);
        const provider = url.searchParams.get("provider"), challenge = url.searchParams.get("code_challenge"), appState = url.searchParams.get("state");
        if (!provider || !providers.has(provider as OAuthProvider) || !challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)
          || url.searchParams.get("code_challenge_method") !== "S256" || !appState || !/^[A-Za-z0-9_-]{16,256}$/.test(appState)
          || url.searchParams.get("redirect_uri") !== APP_AUTH_REDIRECT || url.searchParams.has("link") || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return fail(400, "invalid_request");
        const flowId = random();
        appFlows.set(flowId, { challenge, state: appState, expiresAt: now() + 600_000 });
        oauthStart(req, res, url, provider, flowId); return true;
      }
      const mutation = ["POST", "PATCH", "DELETE"].includes(method);
      const data = mutation ? helpers.bodyObject(await helpers.readBody(req)) : {};
      if (method === "POST" && path === R.appToken) {
        const key = opaque(data.code) ? hash(data.code) : "", code = appCodes.get(key);
        appCodes.delete(key);
        const owner = code && account(code.accountId);
        if (!code || !owner || code.expiresAt <= now() || typeof data.codeVerifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(data.codeVerifier)
          || !equal(createHash("sha256").update(data.codeVerifier).digest("base64url"), code.challenge)) return fail(400, "invalid_grant");
        let device: DeviceInfo;
        try { device = deviceInfo(data, false); } catch { return fail(400, "invalid_grant"); }
        json(appGrant(owner, device));
      }
      else if (method === "POST" && (path === R.emailStart || path === R.appEmailStart)) json(await start(req, data, path === R.appEmailStart));
      else if (method === "POST" && (path === R.emailVerify || path === R.appEmailVerify)) json(verifyEmail(req, res, data, path === R.appEmailVerify));
      else if (method === "POST" && path === R.signOut) {
        const found = webSession(req);
        if (found) { state.sessions = state.sessions.filter(item => item !== found.session); store.changed(); }
        cookies(res); json({ ok: true });
      } else if (method === "GET" && path === R.providers) {
        json({ v: 1, providers: OAUTH_PROVIDERS.map(id => ({ id, enabled: providers.has(id), comingSoon: !providers.has(id) && options.dev })), signupOpen: options.signupOpen, recovery: true });
      } else if (method === "GET" && path === R.me) {
        const owner = requireWeb(req, { mutation: false });
        json({ account: view(owner), csrfToken: csrfFor(webSession(req)!.session) });
      } else if ((method === "GET" || method === "PATCH") && path === R.account) {
        const owner = requireWeb(req, { mutation });
        if (mutation) {
          if (data.name !== null && !label(data.name, 80)) fail(400, "invalid_request");
          owner.name = data.name === null ? null : (data.name as string).trim(); store.changed();
        }
        json(accountAnswer(owner, webSession(req)?.session.id));
      } else if (method === "DELETE" && path.startsWith("/v1/account/identities/")) {
        const owner = requireWeb(req, { mutation: true }), provider = path.slice("/v1/account/identities/".length);
        const linked = state.identities.find(item => item.accountId === owner.id && item.provider === provider);
        if (!linked) fail(404, "not_found");
        if (!owner.email && state.identities.filter(item => item.accountId === owner.id).length <= 1) fail(409, "last_identity");
        state.identities = state.identities.filter(item => item !== linked); store.changed(); json(accountAnswer(owner, webSession(req)?.session.id));
      } else if (method === "DELETE" && path.startsWith("/v1/account/sessions/")) {
        const owner = requireWeb(req, { mutation: true }), id = decodeURIComponent(path.slice("/v1/account/sessions/".length));
        const session = state.sessions.find(item => item.accountId === owner.id && item.id === id);
        if (!session) fail(404, "not_found");
        state.sessions = state.sessions.filter(item => item !== session); store.changed(); json({ ok: true });
      } else if (method === "POST" && (path === R.signOutEverywhere || path === R.deleteAccount)) {
        const owner = requireWeb(req, { mutation: true });
        if (path === R.deleteAccount && cleanEmail(data.email) !== owner.email) fail(400, "invalid_request");
        if (path === R.deleteAccount) for (const hook of beforeDeleteHooks) await hook(owner, data);
        removeSessions(owner.id);
        if (path === R.deleteAccount) {
          state.accounts = state.accounts.filter(item => item !== owner);
          state.identities = state.identities.filter(item => item.accountId !== owner.id);
          for (const [key, grant] of grants) if (grant.accountId === owner.id) grants.delete(key);
          for (const [key, attempt] of attempts) if (attempt.email === owner.email) attempts.delete(key);
          store.close();
          for (const hook of deletedHooks) { try { await hook(owner.id); } catch { console.error("Account deletion cleanup failed."); } }
        }
        cookies(res); json({ ok: true });
      } else if (path === R.deviceLookup && method === "GET") {
        requireWeb(req, { mutation: false });
        const device = [...devices.values()].find(item => item.userCode === url.searchParams.get("code") && !item.accountId && !item.denied);
        if (!device) return fail(404, "not_found");
        json({ device: { name: device.device.name, platform: device.device.platform }, userCode: device.userCode, expiresAt: device.expiresAt });
      } else if (method === "POST" && (path === R.deviceApprove || path === R.deviceDeny)) {
        const owner = requireWeb(req, { mutation: true });
        const device = [...devices.values()].find(item => item.userCode === data.userCode && !item.accountId && !item.denied);
        if (!device) return fail(404, "not_found");
        device.accountId = owner.id;
        device.denied = path === R.deviceDeny;
        json({ ok: true });
      } else if (method === "POST" && path === R.desktopAuthorize) {
        const device = deviceInfo(data, false);
        rate(`authorize:${ip(req)}`, 30);
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let userCode: string;
        do { const chars = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join(""); userCode = `${chars.slice(0, 5)}-${chars.slice(5)}`; }
        while ([...devices.values()].some(item => item.userCode === userCode));
        const deviceCode = random();
        devices.set(hash(deviceCode), { userCode, device, expiresAt: now() + 900_000, interval: 5, lastPollAt: null, accountId: null, denied: false });
        json({ cloudContractVersion: 1, deviceCode, userCode, verificationUri: `${pages}/cloud/desktop`, verificationUriComplete: `${pages}/cloud/desktop?code=${userCode}`, expiresIn: 900, interval: 5 });
      } else if (method === "POST" && path === R.desktopToken) {
        const key = opaque(data.deviceCode) ? hash(data.deviceCode) : "", device = devices.get(key);
        if (!device) return fail(400, expiredDevices.has(key) ? "expired_token" : "invalid_grant");
        // a second of slack: poll timers and network delay jitter around the interval
        if (device.lastPollAt !== null && now() - device.lastPollAt < device.interval * 1000 - 1000) {
          device.lastPollAt = now(); device.interval += 5; fail(400, "slow_down", { interval: device.interval });
        }
        device.lastPollAt = now();
        if (device.denied) { devices.delete(key); fail(400, "access_denied"); }
        if (!device.accountId) return fail(400, "authorization_pending");
        const owner = account(device.accountId);
        devices.delete(key);
        if (!owner) return fail(400, "invalid_grant");
        for (const hook of signedInHooks) hook(owner);
        json(appGrant(owner, device.device));
      } else if ((method === "GET" || method === "DELETE") && path === R.appSession) {
        const found = appSession(req);
        if (!found) return fail(401, "invalid_token");
        if (method === "DELETE") { state.sessions = state.sessions.filter(item => item !== found.session); store.changed(); json({ ok: true }); }
        else {
          let extra: Record<string, unknown> = { entitlement: { plan: "free", status: "inactive", expiresAt: null, version: 0 } };
          for (const extension of extensions) extra = { ...extra, ...await extension(found.account.id) };
          if (!state.sessions.includes(found.session)) return fail(401, "invalid_token");
          json({ ...extra, ...identity(found.account, found.session) });
        }
      } else if (method === "POST" && path === R.enrollGrant) {
        const found = appSession(req);
        if (!found) return fail(401, "invalid_token");
        const enrollToken = random(), expiresAt = now() + 600_000;
        grants.set(hash(enrollToken), { accountId: found.account.id, sessionId: found.session.id, expiresAt });
        json({ v: 1, enrollToken, expiresAt, dashboardUrl: publicUrl });
      } else fail(404, "not_found");
    } catch (error) {
      const known = error as { status?: number; code?: string; message?: string };
      if (path === R.appToken) { json({ error: "invalid_grant" }, 400); return true; }
      const status = known.status ?? 500, code = known.code ?? "failed";
      json({ error: path.startsWith("/api/cloud/") ? code : known.status ? known.message : "Request failed.", ...(path.startsWith("/api/cloud/") ? {} : { code }), ...(error instanceof AuthError ? error.fields : {}) }, status);
    }
    return true;
  }
  return {
    handle, webSession, requireWeb, appSession, account,
    accountByEmail: (email: string) => state.accounts.find(item => item.email === email) ?? null,
    /** what the account holds, for its owner's export: no token, hash or code */
    exportAccount(owner: Account) {
      const { account: profile, identities, sessions } = accountAnswer(owner, undefined);
      return { account: profile, identities, sessions: sessions.map(({ current: _current, ...session }) => session) };
    },
    extendSession(fn: (accountId: string) => Promise<Record<string, unknown>> | Record<string, unknown>) { extensions.push(fn); },
    beforeAccountDelete(fn: (owner: Account, body: Record<string, unknown>) => void | Promise<void>) { beforeDeleteHooks.push(fn); },
    onAccountDeleted(fn: (accountId: string) => void | Promise<void>) { deletedHooks.push(fn); },
    onSignedIn(fn: (account: Account) => void) { signedInHooks.push(fn); },
    consumeEnrollGrant(token: string) {
      sweep();
      const key = hash(token), grant = grants.get(key);
      grants.delete(key);
      // a grant dies with the app session that asked for it (signed out, revoked, everywhere)
      return grant && account(grant.accountId) && state.sessions.some(item => item.id === grant.sessionId && item.accountId === grant.accountId && item.expiresAt > now()) ? grant.accountId : null;
    },
    close() { clearInterval(timer); store.close(); },
  };
}
