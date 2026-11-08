// the account contract of the hosted service (dashboard/server): who a person is, how they sign in, and the sessions
// the website and the apps hold. version 1. the Admin contract v1 routes the desktop app already speaks
// (/api/cloud/app/sign-in/*, /api/cloud/desktop/{authorize,token,session}) keep their shapes; everything here is additive.
// owned by the accounts work: other modules import it, they do not edit it.

export type SignInProvider = "email" | "google" | "apple" | "x";
export const OAUTH_PROVIDERS = ["google", "apple", "x"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** the email code the apps' sign-in sheet takes (Admin contract v1: eight digits). */
export const EMAIL_CODE_DIGITS = 8;
export const EMAIL_CODE_TTL_SECONDS = 600;
export const EMAIL_CODE_TRIES = 5;
export const EMAIL_RESEND_SECONDS = 30;

/** cookies the website session uses. the session cookie is HttpOnly; the csrf cookie is readable so the page can echo
 * it in CSRF_HEADER on every cookie-authenticated POST, PATCH and DELETE. */
export const SESSION_COOKIE = "omb_dash";
export const CSRF_COOKIE = "omb_csrf";
export const CSRF_HEADER = "x-omb-csrf";

/** the deep link a phone sign-in returns to: openmausbot://auth?code=...&state=... or ?error=...&state=... */
export const APP_AUTH_REDIRECT = "openmausbot://auth";

export interface AccountView {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
  /** every way this account can sign in, email first when it has one. */
  providers: SignInProvider[];
}
export interface IdentityView {
  provider: OAuthProvider;
  /** the address the provider vouched for, or null (x often has none). */
  email: string | null;
  /** the provider's display handle or name, for the account page only. */
  label: string | null;
  addedAt: number;
}
export interface SessionView {
  id: string;
  kind: "web" | "desktop" | "mobile";
  /** the device's own name (the app sends it) or a browser label for the website. */
  name: string;
  platform: string | null;
  appVersion: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** the session this request came with. */
  current: boolean;
}
export interface ProviderView {
  id: OAuthProvider;
  /** configured with real keys (or a fixture provider): the button signs in. */
  enabled: boolean;
  /** not configured; only true on a development service, where the button says "coming soon". */
  comingSoon: boolean;
}

/** ?error= on /sign-in (and on the app deep link) after a provider sign-in that did not finish. */
export type OAuthErrorCode = "oauth_denied" | "oauth_failed" | "oauth_expired" | "provider_unavailable" | "signup_closed" | "identity_taken";

/** every route, for the page and the apps. methods and bodies are listed beside each. */
export const ACCOUNT_ROUTES = {
  // website, no session needed
  providers: "/v1/auth/providers", //           GET  -> ProvidersAnswer
  emailStart: "/v1/auth/start", //              POST { email, pending? } -> EmailStartAnswer
  emailVerify: "/v1/auth/verify", //            POST { attempt, code } -> WebSignInAnswer (+ session and csrf cookies)
  /** GET ?next=/path (same-origin path, default /): 302 to the provider; it comes back to oauthCallback and then to next. */
  oauthStart: (provider: OAuthProvider) => `/v1/auth/oauth/${provider}/start`,
  /** GET for google and x, POST form for apple (form_post). */
  oauthCallback: (provider: OAuthProvider) => `/v1/auth/oauth/${provider}/callback`,
  // website, session cookie (+ CSRF_HEADER on mutations)
  me: "/v1/me", //                              GET  -> MeAnswer
  signOut: "/v1/auth/signout", //               POST {} -> { ok: true } (this browser only)
  account: "/v1/account", //                    GET  -> AccountAnswer; PATCH { name } -> AccountAnswer
  identity: (provider: OAuthProvider) => `/v1/account/identities/${provider}`, // DELETE -> AccountAnswer (refused for the last way in)
  session: (id: string) => `/v1/account/sessions/${encodeURIComponent(id)}`, //  DELETE -> { ok: true }
  signOutEverywhere: "/v1/account/signout-everywhere", // POST {} -> { ok: true } (every browser and app, this one too)
  deleteAccount: "/v1/account/delete", //       POST { email, cancelBilling?, destroyDesktopsNow? } (email must equal the account's) -> { ok: true }
  /** link another provider to the signed-in account: GET oauthStart(provider)?link=1&next=/account. */
  deviceLookup: "/v1/auth/device", //           GET ?code=XXXXX-XXXXX -> DeviceLookupAnswer
  deviceApprove: "/v1/auth/device/approve", //  POST { userCode } -> { ok: true }
  deviceDeny: "/v1/auth/device/deny", //        POST { userCode } -> { ok: true }
  // apps
  /** GET ?provider&code_challenge&code_challenge_method=S256&state&redirect_uri=APP_AUTH_REDIRECT: 302 to the provider
   * (provider=email opens the website sign-in first); it ends at the deep link with a one-time code. */
  appStart: "/v1/auth/app/start",
  appToken: "/v1/auth/app/token", //            POST { code, codeVerifier, deviceName, platform, appVersion? } -> AppGrant
  /** bearer app session: a one-time token the app hands its own workspace so it enrolls into this account's dashboard. */
  enrollGrant: "/v1/app/enroll-grant", //       POST {} -> EnrollGrantAnswer
  // Admin contract v1 (unchanged shapes; bearer omc_ token where signed in)
  appEmailStart: "/api/cloud/app/sign-in/start",
  appEmailVerify: "/api/cloud/app/sign-in/verify",
  desktopAuthorize: "/api/cloud/desktop/authorize",
  desktopToken: "/api/cloud/desktop/token",
  appSession: "/api/cloud/desktop/session", //  GET -> AppSessionAnswer; DELETE {} -> { ok: true }
} as const;

export interface ProvidersAnswer { v: 1; providers: ProviderView[]; signupOpen: boolean }
export interface EmailStartAnswer { attempt: string; expiresIn: number; resendAfter: number; signupOpen: boolean }
export interface WebSignInAnswer { account: AccountView; csrfToken: string; created: boolean; redirect?: string }
export interface MeAnswer { account: AccountView; csrfToken: string }
export interface AccountAnswer { account: AccountView; identities: IdentityView[]; sessions: SessionView[] }
export interface DeviceLookupAnswer { device: { name: string; platform: string }; userCode: string; expiresAt: number }
/** what an app sign-in ends in (Admin contract v1's verify answer). */
export interface AppGrant {
  cloudContractVersion: 1;
  accessToken: string;
  expiresAt: number;
  device: { id: string };
  account: { id: string; email: string };
}
export interface EnrollGrantAnswer { v: 1; enrollToken: string; expiresAt: number; dashboardUrl: string }
/** GET /api/cloud/desktop/session: the identity part. billing adds entitlement, cloud and the rest beside it. */
export interface AppSessionIdentity {
  cloudContractVersion: 1;
  expiresAt: number;
  device: { id: string };
  account: { id: string; email: string };
}

/** the error answer of the /v1 routes: { error: human text, code }. the Admin contract v1 routes (/api/cloud/*) answer
 * { error: code } instead, as the shipped apps read it. */
export type AccountErrorCode =
  | "billing_active"
  | "invalid_request" | "invalid_email" | "wrong_code" | "invalid_code" | "expired" | "rate_limited" | "signup_closed"
  | "signed_out" | "invalid_token" | "forbidden" | "csrf" | "not_found" | "last_identity" | "identity_taken"
  | "authorization_pending" | "slow_down" | "access_denied" | "expired_token" | "invalid_grant" | "provider_unavailable" | "failed";
