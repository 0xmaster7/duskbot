import { cleanCode, cleanEmail, parseSignInStart, SIGN_IN_TRIES, startFailure, verifyFailure } from "../../../electron/cloud-signin.mjs";
import { ACCOUNT_ROUTES, APP_AUTH_REDIRECT, type OAuthErrorCode, type OAuthProvider } from "../../../shared/account-api";
import type { CloudSignInStart } from "../../../electron/cloud-account.mjs";
import type { SignInVerify } from "@/components/account-gate/bridge";
import type { MobilePlatform } from "../platform";

export type MobileAccount = { id: string; email: string };
type StoredGrant = { origin: string; token: string; expiresAt: number; account: MobileAccount; deviceId: string };
export type AuthResult = false | SignInVerify | { outcome: OAuthErrorCode | "invalid-state" };
const TOKEN = /^omc_[A-Za-z0-9_-]{43}$/;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const SECRET = "omb.account";
const PENDING = "omb.account.pending";
const OAUTH_ERRORS: readonly string[] = ["oauth_denied", "oauth_failed", "oauth_expired", "provider_unavailable", "signup_closed", "identity_taken"];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const identity = (value: unknown): value is MobileAccount => object(value) && typeof value.id === "string" && Boolean(value.id) && typeof value.email === "string" && Boolean(cleanEmail(value.email));
const expiry = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const parse = (value: string | null): unknown => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function isAccountAuthUrl(value: string): boolean {
  try { const url = new URL(value); return `${url.protocol}//${url.host}` === APP_AUTH_REDIRECT && !url.pathname && !url.username && !url.password && !url.hash; } catch { return false; }
}

class AccountRequestError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly opaque = false) { super("Account request failed"); }
}

export function createMobileAccount({ platform, origin, fetch: requestFetch = globalThis.fetch }: {
  platform: MobilePlatform; origin: string; fetch?: typeof globalThis.fetch;
}) {
  let grant: StoredGrant | null = null;
  let attempt: { id: string; email: string; expiresAt: number; wrong: number } | null = null;
  let generation = 0;
  const device = () => ({ deviceName: platform.deviceName().trim().slice(0, 100), platform: platform.kind === "web" ? "linux" : platform.kind,
    appVersion: /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(platform.appVersion) ? platform.appVersion : "0.0.0" });
  const request = async (path: string, method = "GET", body?: unknown, token?: string): Promise<unknown> => {
    const response = await requestFetch(`${origin}${path}`, { method, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json", accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (Number(response.headers.get("content-length")) > 65_536) { await response.body?.cancel(); throw new AccountRequestError(response.status, undefined, true); }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "", size = 0;
    if (reader) {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65_536) { await reader.cancel(); throw new AccountRequestError(response.status, undefined, true); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    let result: unknown;
    try { result = JSON.parse(text); } catch { throw new AccountRequestError(response.status, undefined, true); }
    if (!response.ok) throw new AccountRequestError(response.status, object(result) && typeof result.error === "string" ? result.error : undefined);
    return result;
  };
  const adopt = async (value: unknown, stamp: number): Promise<boolean> => {
    if (stamp !== generation || !object(value) || value.cloudContractVersion !== 1 || typeof value.accessToken !== "string" || !TOKEN.test(value.accessToken)
      || !expiry(value.expiresAt) || value.expiresAt <= Date.now() || !object(value.device) || typeof value.device.id !== "string" || !value.device.id || !identity(value.account)) return false;
    const next = { origin, token: value.accessToken, expiresAt: value.expiresAt, account: { id: value.account.id, email: value.account.email }, deviceId: value.device.id };
    await platform.secrets.set(SECRET, JSON.stringify(next));
    if (stamp !== generation) { await platform.secrets.remove(SECRET); return false; }
    grant = next; attempt = null;
    return true;
  };
  return {
    account: () => grant?.account ?? null,
    async restore(): Promise<MobileAccount | null> {
      const stamp = generation;
      grant = null;
      const value = parse(await platform.secrets.get(SECRET));
      if (!object(value) || value.origin !== origin) return null;
      if (typeof value.token !== "string" || !TOKEN.test(value.token) || !expiry(value.expiresAt) || !identity(value.account) || typeof value.deviceId !== "string" || !value.deviceId) {
        await platform.secrets.remove(SECRET); return null;
      }
      const saved = value as StoredGrant;
      try {
        await request(ACCOUNT_ROUTES.appSession, "GET", undefined, saved.token);
        if (stamp === generation) grant = saved;
      } catch (error) {
        if (stamp !== generation) return null;
        if (error instanceof AccountRequestError && error.status === 401 && error.code === "invalid_token") await platform.secrets.remove(SECRET);
        else if (!(error instanceof AccountRequestError) && saved.expiresAt > Date.now()) grant = saved;
      }
      return grant?.account ?? null;
    },
    async emailStart(email: string): Promise<CloudSignInStart> {
      const address = cleanEmail(email);
      if (!address) return { outcome: "invalid-email" };
      if (attempt?.email !== address) attempt = null;
      const stamp = generation;
      try {
        const result = parseSignInStart(await request(ACCOUNT_ROUTES.appEmailStart, "POST", { email: address, ...device() }));
        if (!result || stamp !== generation) return { outcome: "failed" };
        attempt = { id: result.attempt, email: address, expiresAt: Date.now() + result.expiresIn * 1000, wrong: 0 };
        return { outcome: "sent", email: address, expiresAt: attempt.expiresAt, resendAt: Date.now() + result.resendAfter * 1000, signupOpen: result.signupOpen };
      } catch (error) { return { outcome: startFailure(error) }; }
    },
    async emailVerify(code: string): Promise<SignInVerify> {
      const pending = attempt, digits = cleanCode(code);
      if (!pending || Date.now() >= pending.expiresAt) { attempt = null; return { outcome: "expired" }; }
      if (!digits) return { outcome: "wrong-code", triesLeft: SIGN_IN_TRIES - pending.wrong };
      const stamp = generation;
      try {
        const value = await request(ACCOUNT_ROUTES.appEmailVerify, "POST", { attempt: pending.id, code: digits });
        return { outcome: await adopt(value, stamp) ? "signed-in" : "failed" };
      } catch (error) {
        const outcome = verifyFailure(error);
        if (outcome === "wrong-code" && attempt === pending && ++pending.wrong < SIGN_IN_TRIES) return { outcome, triesLeft: SIGN_IN_TRIES - pending.wrong };
        if (attempt === pending) attempt = null;
        return { outcome: outcome === "wrong-code" ? "expired" : outcome };
      }
    },
    cancelEmail() { attempt = null; },
    async oauthStart(provider: OAuthProvider): Promise<void> {
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      await platform.secrets.set(PENDING, JSON.stringify({ verifier, state, provider, at: Date.now(), origin }));
      try {
        await platform.openExternal(`${origin}${ACCOUNT_ROUTES.appStart}?${new URLSearchParams({ provider, code_challenge: challenge, code_challenge_method: "S256", state, redirect_uri: APP_AUTH_REDIRECT })}`);
      } catch (error) { await platform.secrets.remove(PENDING); throw error; }
    },
    async handleAuthUrl(value: string): Promise<AuthResult> {
      if (!isAccountAuthUrl(value)) return false;
      const url = new URL(value);
      const stamp = ++generation;
      const pending = parse(await platform.secrets.get(PENDING));
      await platform.secrets.remove(PENDING);
      if (!object(pending) || pending.origin !== origin || typeof pending.state !== "string" || url.searchParams.get("state") !== pending.state
        || typeof pending.verifier !== "string" || !OPAQUE.test(pending.verifier) || typeof pending.at !== "number" || pending.at > Date.now() || Date.now() - pending.at >= 15 * 60_000) return { outcome: "invalid-state" };
      const error = url.searchParams.get("error");
      if (error) return { outcome: OAUTH_ERRORS.includes(error) ? error as OAuthErrorCode : "oauth_failed" };
      const code = url.searchParams.get("code");
      if (!code) return { outcome: "failed" };
      try {
        const result = await request(ACCOUNT_ROUTES.appToken, "POST", { code, codeVerifier: pending.verifier, ...device() });
        return { outcome: await adopt(result, stamp) ? "signed-in" : "failed" };
      } catch { return { outcome: "failed" }; }
    },
    async signOut(): Promise<void> {
      ++generation;
      const token = grant?.token;
      grant = null; attempt = null;
      await Promise.all([platform.secrets.remove(SECRET), platform.secrets.remove(PENDING)]);
      if (token) { try { await request(ACCOUNT_ROUTES.appSession, "DELETE", {}, token); } catch {} }
    },
    async enrollGrant(): Promise<{ enrollToken: string; dashboardUrl: string } | null> {
      if (!grant) return null;
      try {
        const value = await request(ACCOUNT_ROUTES.enrollGrant, "POST", {}, grant.token);
        if (!object(value) || typeof value.enrollToken !== "string" || !OPAQUE.test(value.enrollToken) || typeof value.dashboardUrl !== "string") return null;
        const url = new URL(value.dashboardUrl);
        return url.origin === origin && !url.username && !url.password ? { enrollToken: value.enrollToken, dashboardUrl: value.dashboardUrl } : null;
      } catch { return null; }
    },
  };
}
