import type { CommandKind, CommandView, WorkspaceDetail, WorkspaceSummary } from "../../../shared/dashboard-protocol";

export interface Account { id: string; email: string }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) { super(message); }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
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

export const api = {
  me: () => call<{ account: Account }>("/v1/me"),
  start: (email: string) => call<{ attempt: string; resendAfter: number; expiresIn: number }>("/v1/auth/start", { method: "POST", body: { email } }),
  verify: (attempt: string, code: string) => call<{ account: Account }>("/v1/auth/verify", { method: "POST", body: { attempt, code } }),
  signOut: () => call<unknown>("/v1/auth/signout", { method: "POST", body: {} }),
  workspaces: (signal?: AbortSignal) => call<{ workspaces: WorkspaceSummary[] }>("/v1/workspaces", { signal }),
  workspace: (id: string, signal?: AbortSignal) => call<WorkspaceDetail>(`/v1/workspaces/${encodeURIComponent(id)}`, { signal }),
  command: (id: string, kind: CommandKind, target: string) =>
    call<{ command: CommandView }>(`/v1/workspaces/${encodeURIComponent(id)}/commands`, { method: "POST", body: { kind, target } }),
  rename: (id: string, name: string) => call<unknown>(`/v1/workspaces/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } }),
  forget: (id: string) => call<unknown>(`/v1/workspaces/${encodeURIComponent(id)}`, { method: "DELETE", body: {} }),
  claim: (token: string) => call<{ workspace: WorkspaceSummary }>("/v1/claim", { method: "POST", body: { token } }),
};
