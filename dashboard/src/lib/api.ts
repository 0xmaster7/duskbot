import type { CommandKind, CommandView, WorkspaceDetail, WorkspaceSummary } from "../../../shared/dashboard-protocol";
import type { AccountDevice, AccountProfile, AuthProviders, BillingOverview, CheckoutAnswer, CheckoutRequest, CloudDesktop, DesktopId, EmailCodeStart, Identity, IdentityProvider, MachineSpec, NotificationPrefs, PlanCatalog, Selection } from "../data/contracts";

export type Scenario = "signedout" | "new" | "mac" | "cloud" | "provisioning";
export interface Account { id: string; email: string; name?: string | null }
export interface AccountData { profile: AccountProfile; identities: Identity[]; devices: AccountDevice[]; notifications: NotificationPrefs }

function fixtureMode(): Scenario | null {
  if (!(import.meta.env.DEV || import.meta.env.VITE_DASH_FIXTURES === "1") || typeof location === "undefined") return null;
  const valid = (value: string | null): value is Scenario => value !== null && ["signedout", "new", "mac", "cloud", "provisioning"].includes(value);
  const value = new URLSearchParams(location.search).get("fixture");
  try {
    if (value === "off") { sessionStorage.removeItem("omb-dash-fixture"); return null; }
    if (valid(value)) { sessionStorage.setItem("omb-dash-fixture", value); return value; }
    const saved = sessionStorage.getItem("omb-dash-fixture");
    return valid(saved) ? saved : null;
  } catch { return valid(value) ? value : null; }
}

export const FIXTURE: Scenario | null = fixtureMode();

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) { super(message); }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  if (FIXTURE) {
    init?.signal?.throwIfAborted();
    await new Promise<void>((resolve) => setTimeout(resolve, 140));
    init?.signal?.throwIfAborted();
    const { fixtureCall } = await import("../data/fixture-server");
    init?.signal?.throwIfAborted();
    return fixtureCall(init?.method ?? "GET", path, init?.body) as T;
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      headers: { accept: "application/json", ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("The dashboard could not be reached. Check your connection.", 0, "offline");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? `The dashboard answered ${res.status}.`, res.status, data?.code ?? null);
  return data as T;
}

const send = <T = unknown>(path: string, method: string, body: unknown = {}) => call<T>(path, { method, body });
const workspacePath = (id: string) => `/v1/workspaces/${encodeURIComponent(id)}`;
const cloudPath = (id: string) => `/v1/clouds/${encodeURIComponent(id)}`;

export const api = {
  me: () => call<{ account: Account }>("/v1/me"),
  authProviders: () => call<AuthProviders>("/v1/auth/providers"),
  start: (email: string, intent: "signin" | "signup" = "signin") => send<EmailCodeStart>("/v1/auth/start", "POST", { email, intent }),
  verify: (attempt: string, code: string) => send<{ account: Account; created: boolean }>("/v1/auth/verify", "POST", { attempt, code }),
  oauthUrl: (provider: IdentityProvider, intent: "signin" | "signup") => `/v1/auth/oauth/${provider}/start?intent=${intent}`,
  signOut: () => send("/v1/auth/signout", "POST"),
  account: () => call<AccountData>("/v1/account"),
  updateProfile: (profile: { name: string }) => send("/v1/account", "PATCH", profile),
  finishOnboarding: () => send("/v1/account/onboarded", "POST"),
  setNotifications: (prefs: NotificationPrefs) => send("/v1/account/notifications", "PUT", prefs),
  unlinkIdentity: (provider: IdentityProvider) => send(`/v1/account/identities/${encodeURIComponent(provider)}`, "DELETE"),
  revokeDevice: (id: string) => send(`/v1/account/devices/${encodeURIComponent(id)}`, "DELETE"),
  signOutEverywhere: () => send("/v1/auth/signout-everywhere", "POST"),
  deleteAccount: (confirmEmail: string) => send("/v1/account", "DELETE", { confirm: confirmEmail }),
  catalog: () => call<PlanCatalog>("/v1/billing/catalog"),
  billing: () => call<BillingOverview>("/v1/billing"),
  checkout: (req: CheckoutRequest) => send<CheckoutAnswer>("/v1/billing/checkout", "POST", req),
  portal: () => send<{ url: string }>("/v1/billing/portal", "POST"),
  changePlan: (selection: Selection) => send("/v1/billing/change", "POST", { selection }),
  cancel: (reason: string) => send("/v1/billing/cancel", "POST", { reason }),
  clouds: () => call<{ clouds: CloudDesktop[] }>("/v1/clouds"),
  power: (id: string, on: boolean) => send<CloudDesktop>(`${cloudPath(id)}/power`, "POST", { on }),
  resize: (id: string, req: { tier: Exclude<DesktopId, "none">; size: MachineSpec | null }) => send<CloudDesktop>(`${cloudPath(id)}/resize`, "POST", req),
  connections: () => call<{ byWorkspace: Record<string, string[]> }>("/v1/connectors"),
  workspaces: (signal?: AbortSignal) => call<{ workspaces: WorkspaceSummary[] }>("/v1/workspaces", { signal }),
  workspace: (id: string, signal?: AbortSignal) => call<WorkspaceDetail>(workspacePath(id), { signal }),
  command: (id: string, kind: CommandKind, target: string) => send<{ command: CommandView }>(`${workspacePath(id)}/commands`, "POST", { kind, target }),
  rename: (id: string, name: string) => send(workspacePath(id), "PATCH", { name }),
  forget: (id: string) => send(workspacePath(id), "DELETE"),
  claim: (token: string) => send<{ workspace: WorkspaceSummary }>("/v1/claim", "POST", { token }),
};
