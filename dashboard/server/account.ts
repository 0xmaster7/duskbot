import type { Account } from "./store.ts";

export class AccountError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super("Sign-in failed.");
    this.status = status;
    this.code = code;
  }
}

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // oxlint-disable-next-line no-control-regex
  return email.length <= 254 && !/[\x00-\x1f\x7f]/.test(email) && /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ? email : null;
}

function failure(status: number, data: Record<string, unknown>): AccountError {
  if (status === 429) return new AccountError(429, "rate_limited");
  if (status === 410) return new AccountError(410, "expired");
  const reason = typeof data.code === "string" ? data.code : data.error;
  if (status === 400 && reason === "invalid_code") return new AccountError(400, "wrong_code");
  if (status === 403 && ["sso", "two_factor", "signup_closed", "device_limit"].includes(reason as string)) return new AccountError(403, reason as string);
  return new AccountError(502, "failed");
}

export function createAccountProxy(origin: string, request: typeof fetch = fetch, now: () => number = Date.now) {
  const accountOrigin = new URL(origin).origin;
  async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
    try {
      const response = await request(`${accountOrigin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        redirect: "error", signal: AbortSignal.timeout(15_000) });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (reader) while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 64 * 1024) { await reader.cancel(); throw new AccountError(502, "failed"); }
          chunks.push(value);
        }
      } finally { reader?.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new AccountError(502, "failed");
      if (!response.ok) throw failure(response.status, data);
      return data;
    } catch (error) {
      if (error instanceof AccountError) throw error;
      throw new AccountError(502, "failed");
    }
  }
  return {
    async start(email: string) {
      const data = await call("/api/cloud/app/sign-in/start", { email, deviceName: "OpenMausBot dashboard", platform: "linux", appVersion: "1.0.0" });
      if (data.cloudContractVersion !== 1 || typeof data.attempt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.attempt)
        || !Number.isSafeInteger(data.expiresIn) || (data.expiresIn as number) < 60 || (data.expiresIn as number) > 3600) throw new AccountError(502, "failed");
      const resendAfter = Number.isSafeInteger(data.resendAfter) && (data.resendAfter as number) >= 0 && (data.resendAfter as number) <= 600 ? data.resendAfter as number : 30;
      return { attempt: data.attempt, expiresIn: data.expiresIn as number, resendAfter };
    },
    async verify(attempt: string, code: string): Promise<Account> {
      const data = await call("/api/cloud/app/sign-in/verify", { attempt, code });
      const token = data.accessToken;
      if (typeof token !== "string" || !/^omc_[A-Za-z0-9_-]{43}$/.test(token)) throw new AccountError(502, "failed");
      try {
        const account = data.account as Account | undefined;
        const device = data.device as { id?: unknown } | undefined;
        if (data.cloudContractVersion !== 1 || typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt) || data.expiresAt <= now()
          || !device || typeof device.id !== "string" || !device.id.length || device.id.length > 200
          || !account || typeof account.id !== "string" || !account.id.length || account.id.length > 200 || !cleanEmail(account.email)) throw new AccountError(502, "failed");
        return { id: account.id, email: account.email };
      } finally {
        try {
          await request(`${accountOrigin}/api/cloud/desktop/session`, { method: "DELETE", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: "{}", redirect: "error", signal: AbortSignal.timeout(5000) });
        } catch { /* the admin credential is never kept, even when revocation is unavailable. */ }
      }
    },
  };
}
