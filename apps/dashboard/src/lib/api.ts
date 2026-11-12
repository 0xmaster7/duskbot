import type { DeletionBlocker, DeleteAccountOptions } from "../../../../shared/billing-api";
import type { CommandKind, CommandView, ConnectorsAnswer, WorkspaceDetail, WorkspaceSummary } from "../../../../shared/dashboard-protocol";
import type { AccountDevice, AccountProfile, AuthProviders, BillingOverview, CheckoutAnswer, CheckoutRequest, CloudDesktop, DesktopId, EmailCodeStart, Identity, IdentityProvider, MachineSpec, NotificationPrefs, PlanCatalog, Selection, SlackWake } from "../data/contracts";
import { track } from "./analytics";
import { accountFromWire, billingFromWire, cartFromQuote, cartFromSelection, catalogFromWire, cloudFromWire, providersFromWire } from "../data/live";
import { CSRF_HEADER, EMAIL_CODE_DIGITS, readCsrfCookie, type AccountAnswer, type AccountView, type BillingOverview as WireBillingOverview, type CancelAnswer, type Catalog, type ChangePreview, type CheckoutAnswer as WireCheckoutAnswer, type CloudDesktopView, type DeviceLookupAnswer, type EmailStartAnswer, type MeAnswer, type ProvidersAnswer, type Quote, type WebSignInAnswer } from "../data/wire";

export type Scenario = "signedout" | "new" | "mac" | "cloud" | "provisioning" | "managed";
export interface Account { id: string; email: string; name?: string | null }
export interface AccountData { profile: AccountProfile; identities: Identity[]; devices: AccountDevice[]; notifications: NotificationPrefs }

function fixtureMode(): Scenario | null {
  if (!(import.meta.env.DEV || import.meta.env.VITE_DASH_FIXTURES === "1") || typeof location === "undefined") return null;
  const valid = (value: string | null): value is Scenario => value !== null && ["signedout", "new", "mac", "cloud", "provisioning", "managed"].includes(value);
  const value = new URLSearchParams(location.search).get("fixture");
  try {
    if (value === "off") { sessionStorage.removeItem("dusk-dash-fixture"); return null; }
    if (valid(value)) { sessionStorage.setItem("dusk-dash-fixture", value); return value; }
    const saved = sessionStorage.getItem("dusk-dash-fixture");
    return valid(saved) ? saved : null;
  } catch { return valid(value) ? value : null; }
}

export const FIXTURE: Scenario | null = fixtureMode();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly blockers: DeletionBlocker[];
  constructor(message: string, status: number, code: string | null, blockers: DeletionBlocker[] = []) { super(message); this.status = status; this.code = code; this.blockers = blockers; }
}

let csrfToken: string | null = null;
let accountId: string | null = null;
let subscriptionId: string | null = null;
let catalogRequest: Promise<PlanCatalog> | null = null;

function csrfHeader(): string {
  const cookie = typeof document === "undefined" ? undefined : readCsrfCookie(document.cookie);
  if (cookie) {
    try { return decodeURIComponent(cookie) || csrfToken || ""; } catch {}
  }
  return csrfToken ?? "";
}

function rememberAccount(account: AccountView, token?: string): Account {
  if (accountId !== account.id) subscriptionId = null;
  accountId = account.id;
  if (token !== undefined) csrfToken = token;
  return { id: account.id, email: account.email, name: account.name };
}

function clearSession() { csrfToken = null; accountId = null; subscriptionId = null; }

async function call<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  if (FIXTURE) {
    init?.signal?.throwIfAborted();
    await new Promise<void>((resolve) => setTimeout(resolve, 140));
    init?.signal?.throwIfAborted();
    const { fixtureCall } = await import("../data/fixture-server");
    init?.signal?.throwIfAborted();
    return fixtureCall(init?.method ?? "GET", path, init?.body) as T;
  }
  const method = init?.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { accept: "application/json", ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...(["POST", "PUT", "PATCH", "DELETE"].includes(method) ? { [CSRF_HEADER]: csrfHeader() } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("can't reach dusk bot. check your connection.", 0, "offline");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string; blockers?: DeletionBlocker[] }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? "something went wrong on our side. try again.", res.status, data?.code ?? null, data?.blockers);
  return data as T;
}

const send = <T = unknown>(path: string, method: string, body: unknown = {}) => call<T>(path, { method, body });
const workspacePath = (id: string) => `/v1/workspaces/${encodeURIComponent(id)}`;
const cloudPath = (id: string) => `/v1/clouds/${encodeURIComponent(id)}`;

function catalog(): Promise<PlanCatalog> {
  if (FIXTURE) return call<PlanCatalog>("/v1/billing/catalog");
  return catalogRequest ??= call<Catalog>("/v1/billing/catalog").then(catalogFromWire).catch((error) => { catalogRequest = null; throw error; });
}

async function overview(): Promise<{ billing: BillingOverview; clouds: CloudDesktop[] }> {
  if (FIXTURE) {
    const [billing, result] = await Promise.all([call<BillingOverview>("/v1/billing"), call<{ clouds: CloudDesktop[] }>("/v1/clouds")]);
    return { billing, clouds: result.clouds };
  }
  const [answer, plans] = await Promise.all([call<WireBillingOverview>("/v1/billing/overview"), catalog()]);
  const billing = billingFromWire(answer, plans);
  subscriptionId = billing.subscription?.id ?? null;
  return { billing, clouds: answer.clouds.map(cloudFromWire).filter((cloud) => cloud !== null) };
}

function subscriptionPath(): string {
  if (!subscriptionId) throw new ApiError("there is no plan to change.", 409, "not_subscribed");
  return `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`;
}

export const api = {
  /** what the account shares: usage counts (off when opted out) and the anonymous summaries its workspaces write */
  dataSharing: (): Promise<{ optOut: boolean; summaries: boolean }> => call("/v1/account/analytics"),
  setDataSharing: (next: { optOut?: boolean; summaries?: boolean }): Promise<{ optOut: boolean; summaries: boolean }> => send("/v1/account/analytics", "PUT", next),
  me: async (): Promise<{ account: Account }> => {
    if (FIXTURE) return call("/v1/me");
    const answer = await call<MeAnswer>("/v1/me");
    return { account: rememberAccount(answer.account, answer.csrfToken) };
  },
  authProviders: async (): Promise<AuthProviders> => FIXTURE ? call("/v1/auth/providers") : providersFromWire(await call<ProvidersAnswer>("/v1/auth/providers")),
  /** `recover`: "Can't sign in?": the mail names the ways the address signs in and carries a one-time link too. */
  start: async (email: string, intent: "signin" | "signup" = "signin", pending?: string, recover = false): Promise<EmailCodeStart> => {
    if (FIXTURE) return send("/v1/auth/start", "POST", { email, intent, ...(recover ? { recover } : {}) });
    const answer = await send<EmailStartAnswer>("/v1/auth/start", "POST", { email, pending, ...(recover ? { recover } : {}) });
    return { attempt: answer.attempt, resendAfter: answer.resendAfter, expiresIn: answer.expiresIn, codeLength: EMAIL_CODE_DIGITS };
  },
  verify: async (attempt: string, code: string): Promise<{ account: Account; created: boolean; redirect?: string }> => {
    if (FIXTURE) return send("/v1/auth/verify", "POST", { attempt, code });
    const answer = await send<WebSignInAnswer>("/v1/auth/verify", "POST", { attempt, code });
    const account = rememberAccount(answer.account, answer.csrfToken);
    if (answer.created) localStorage.removeItem(`dusk-dash-onboarded:${account.id}`);
    return { account, created: answer.created, ...(answer.redirect ? { redirect: answer.redirect } : {}) };
  },
  oauthUrl: (provider: IdentityProvider, intent: "signin" | "signup", opts?: { link?: boolean; next?: string }) => FIXTURE ? `/v1/auth/oauth/${provider}/start?intent=${intent}` : `/v1/auth/oauth/${provider}/start?next=${encodeURIComponent(opts?.next ?? (opts?.link ? "/account" : "/"))}${opts?.link ? "&link=1" : ""}`,
  signOut: async () => { const answer = await send("/v1/auth/signout", "POST"); clearSession(); return answer; },
  account: async (): Promise<AccountData> => {
    if (FIXTURE) return call("/v1/account");
    const answer = await call<AccountAnswer>("/v1/account");
    rememberAccount(answer.account);
    return accountFromWire(answer);
  },
  updateProfile: async (profile: { name: string }) => {
    if (FIXTURE) return send<AccountData>("/v1/account", "PATCH", profile);
    return accountFromWire(await send<AccountAnswer>("/v1/account", "PATCH", profile));
  },
  finishOnboarding: async () => {
    if (FIXTURE) return send("/v1/account/onboarded", "POST");
    if (!accountId) await api.me();
    localStorage.setItem(`dusk-dash-onboarded:${accountId}`, "1");
    track({ name: "onboarding_done" });
  },
  setNotifications: async (prefs: NotificationPrefs) => {
    if (FIXTURE) return send("/v1/account/notifications", "PUT", prefs);
    localStorage.setItem("dusk-dash-notify", JSON.stringify(prefs));
    return prefs;
  },
  unlinkIdentity: async (provider: IdentityProvider) => {
    const path = `/v1/account/identities/${encodeURIComponent(provider)}`;
    if (FIXTURE) return send(path, "DELETE");
    return accountFromWire(await send<AccountAnswer>(path, "DELETE"));
  },
  revokeDevice: (id: string) => send(`/v1/account/${FIXTURE ? "devices" : "sessions"}/${encodeURIComponent(id)}`, "DELETE"),
  signOutEverywhere: async () => { const answer = await send(FIXTURE ? "/v1/auth/signout-everywhere" : "/v1/account/signout-everywhere", "POST"); clearSession(); return answer; },
  deleteAccount: async (email: string, options: DeleteAccountOptions = {}) => { const answer = await (FIXTURE ? send("/v1/account", "DELETE", { confirm: email, ...options }) : send("/v1/account/delete", "POST", { email, ...options })); clearSession(); return answer; },
  deviceLookup: (code: string) => call<DeviceLookupAnswer>(`/v1/auth/device?code=${encodeURIComponent(code)}`),
  deviceApprove: (userCode: string) => send("/v1/auth/device/approve", "POST", { userCode }),
  deviceDeny: (userCode: string) => send("/v1/auth/device/deny", "POST", { userCode }),
  catalog,
  overview,
  quote: async (selection: Selection, signal?: AbortSignal) => {
    if (FIXTURE) return null;
    const plans = await catalog();
    signal?.throwIfAborted();
    return cartFromQuote(await call<Quote>("/v1/billing/quote", { method: "POST", body: { cart: cartFromSelection(selection, plans) }, signal }), plans);
  },
  billing: async () => FIXTURE ? call<BillingOverview>("/v1/billing") : (await overview()).billing,
  checkout: async (req: CheckoutRequest): Promise<CheckoutAnswer> => {
    if (FIXTURE) return send("/v1/billing/checkout", "POST", req);
    const answer = await send<WireCheckoutAnswer>("/v1/billing/checkout", "POST", req.kind === "plan" ? { kind: "cart", source: req.source, cart: cartFromSelection(req.selection, await catalog()) } : req);
    return { url: answer.checkoutUrl, id: answer.checkoutId };
  },
  portal: () => send<{ url: string }>("/v1/billing/portal", "POST"),
  /** what a plan change charges now, in dollars, before anything is applied */
  changeCharge: async (selection: Selection): Promise<number> => {
    if (FIXTURE) return 0;
    const preview = await send<ChangePreview>(`${subscriptionPath()}/preview`, "POST", { cart: cartFromSelection(selection, await catalog()) });
    return preview.chargeNowCents / 100;
  },
  /** applies a plan change only while it charges no more than the person was shown (`approvedUsd`) */
  changePlan: async (selection: Selection, approvedUsd = 0) => {
    if (FIXTURE) return send("/v1/billing/change", "POST", { selection });
    const path = subscriptionPath();
    const preview = await send<ChangePreview>(`${path}/preview`, "POST", { cart: cartFromSelection(selection, await catalog()) });
    if (preview.chargeNowCents > Math.round(approvedUsd * 100)) throw new ApiError("the price changed. check it and confirm again.", 409, "price_changed");
    return send(`${path}/change`, "POST", { confirmation: preview.confirmation });
  },
  cancel: (answer: CancelAnswer | "") => send(FIXTURE ? "/v1/billing/cancel" : `${subscriptionPath()}/cancel`, "POST", answer === "" ? {} : { survey: { answer } }),
  clouds: async (): Promise<{ clouds: CloudDesktop[] }> => {
    if (FIXTURE) return call("/v1/clouds");
    const answer = await call<{ clouds: CloudDesktopView[] }>("/v1/clouds");
    return { clouds: answer.clouds.map(cloudFromWire).filter((cloud) => cloud !== null) };
  },
  power: async (id: string, on: boolean) => {
    if (FIXTURE) return send<CloudDesktop>(`${cloudPath(id)}/power`, "POST", { on });
    const answer = await send<{ cloud: CloudDesktopView }>(`${cloudPath(id)}/power`, "POST", { action: on ? "on" : "off" });
    return cloudFromWire(answer.cloud);
  },
  slackWake: (id: string, signal?: AbortSignal) => call<SlackWake>(`${cloudPath(id)}/slack-wake`, { signal }),
  setSlackWake: (id: string, enabled: boolean) => send<SlackWake>(`${cloudPath(id)}/slack-wake`, "PUT", { enabled }),
  /** a managed cloud whose plan has ended: emails the owner a one-time link that confirms deleting its data */
  askDeleteData: (id: string) => send<{ ok: true; emailed: true }>(`${cloudPath(id)}/delete-data`, "POST"),
  confirmDeleteData: (id: string, token: string) => send<{ ok: true; deleteScheduledAt: number }>(`${cloudPath(id)}/delete-data/confirm`, "POST", { token }),
  cancelDeleteData: (id: string) => send<{ ok: true }>(`${cloudPath(id)}/delete-data/cancel`, "POST"),
  resize: (id: string, req: { tier: Exclude<DesktopId, "none">; size: MachineSpec | null }) => send<CloudDesktop>(`${cloudPath(id)}/resize`, "POST", req),
  connections: () => call<ConnectorsAnswer>("/v1/connectors"),
  workspaces: (signal?: AbortSignal) => call<{ workspaces: WorkspaceSummary[] }>("/v1/workspaces", { signal }),
  workspace: (id: string, signal?: AbortSignal) => call<WorkspaceDetail>(workspacePath(id), { signal }),
  command: (id: string, kind: CommandKind, target: string) => send<{ command: CommandView }>(`${workspacePath(id)}/commands`, "POST", { kind, target }),
  rename: (id: string, name: string) => send(workspacePath(id), "PATCH", { name }),
  forget: (id: string) => send(workspacePath(id), "DELETE"),
  claim: (token: string) => send<{ workspace: WorkspaceSummary }>("/v1/claim", "POST", { token }),
};
