import type { MobilePlatform } from "../platform";

// the phone's half of the hosted account sign-in (w10/accounts, shared/account-api.ts there): the system browser runs
// the provider sign-in and returns to openmausbot://auth with a one-time code, which the app trades for its own token
// with its PKCE verifier. Until that branch lands these mirror its contract; switch to its exports once it is in.
export type AccountProvider = "apple" | "google" | "x" | "email";
export const APP_AUTH_REDIRECT = "openmausbot://auth";
const ROUTES = { appStart: "/v1/auth/app/start", appToken: "/v1/auth/app/token" } as const;

export interface AccountGrant {
  accessToken: string;
  expiresAt: number;
  device: { id: string };
  account: { id: string; email: string };
}

export type AccountErrorCode = "oauth_denied" | "oauth_failed" | "oauth_expired" | "provider_unavailable" | "signup_closed" | "identity_taken" | "state" | "network";

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  constructor(code: AccountErrorCode) {
    super(`mobile.account.err.${code}`);
    this.name = "AccountError";
    this.code = code;
  }
}

const PENDING = "omb.mobile.accountPending";
const TOKEN = "account.token";

/** The hosted account service, or null while accounts are off: the onboarding then skips straight to linking. */
export function accountService(search: string = typeof location === "undefined" ? "" : location.search): string | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const on = env.VITE_OMB_MOBILE_ACCOUNTS === "1" || new URLSearchParams(search).has("accounts");
  return on ? (env.VITE_OMB_ACCOUNT_ORIGIN || "https://cloud.openmausbot.com") : null;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** RFC 7636 S256: base64url(sha256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function appStartUrl(service: string, provider: AccountProvider, challenge: string, state: string): string {
  const url = new URL(ROUTES.appStart, service);
  url.search = new URLSearchParams({ provider, code_challenge: challenge, code_challenge_method: "S256", state, redirect_uri: APP_AUTH_REDIRECT }).toString();
  return url.toString();
}

/** Opens the provider's sign-in in the system browser. The verifier and state wait in prefs for the deep link back. */
export async function startAccountSignIn(platform: MobilePlatform, service: string, provider: AccountProvider): Promise<void> {
  const verifier = randomToken(48);
  const state = randomToken(18);
  await platform.prefs.set(PENDING, JSON.stringify({ verifier, state, provider, at: Date.now() }));
  await platform.openExternal(appStartUrl(service, provider, await codeChallenge(verifier), state));
}

/** `openmausbot://auth?code=&state=` or `?error=&state=`; null for any other link. */
export function parseAuthLink(link: string): { code?: string; error?: string; state: string } | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== "openmausbot:" || (url.hostname || url.pathname.replace(/^\/+/, "")) !== "auth") return null;
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? undefined;
  const error = url.searchParams.get("error") ?? undefined;
  if (!state || (!code && !error)) return null;
  return { state, ...(code ? { code } : {}), ...(error ? { error } : {}) };
}

const KNOWN: readonly AccountErrorCode[] = ["oauth_denied", "oauth_failed", "oauth_expired", "provider_unavailable", "signup_closed", "identity_taken"];

/** Trades the deep link's one-time code for this phone's account token and keeps it in the keychain. A state that does
 * not match the sign-in this phone started is refused. */
export async function finishAccountSignIn(platform: MobilePlatform, service: string, link: { code?: string; error?: string; state: string }): Promise<AccountGrant> {
  const saved = await platform.prefs.get(PENDING);
  const pending = saved ? (JSON.parse(saved) as { verifier: string; state: string }) : null;
  if (!pending || pending.state !== link.state) throw new AccountError("state");
  await platform.prefs.remove(PENDING);
  if (link.error || !link.code) throw new AccountError(KNOWN.includes(link.error as AccountErrorCode) ? link.error as AccountErrorCode : "oauth_failed");
  let response: Response;
  try {
    response = await fetch(new URL(ROUTES.appToken, service), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: link.code, codeVerifier: pending.verifier, deviceName: platform.deviceName(), platform: platform.kind, appVersion: platform.appVersion }),
      credentials: "omit",
    });
  } catch { throw new AccountError("network"); }
  const body = await response.json().catch(() => null) as (AccountGrant & { code?: string }) | null;
  if (!response.ok || !body?.accessToken) throw new AccountError(body?.code === "expired" || body?.code === "invalid_grant" ? "oauth_expired" : "oauth_failed");
  await platform.secrets.set(TOKEN, body.accessToken);
  return body;
}

export async function signedInAccount(platform: MobilePlatform): Promise<boolean> {
  return Boolean(await platform.secrets.get(TOKEN));
}
