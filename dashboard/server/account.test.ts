import { expect, it, vi } from "vitest";
import { AccountError, createAccountProxy } from "./account.ts";

it.each([
  [400, "invalid_code", "wrong_code"],
  [410, "expired", "expired"],
  [403, "sso", "sso"],
  [403, "two_factor", "two_factor"],
  [403, "signup_closed", "signup_closed"],
  [403, "device_limit", "device_limit"],
  [429, "too_many_requests", "rate_limited"],
  [500, "internal_error", "failed"],
])("maps Admin status %s and reason %s to %s", async (status, reason, code) => {
  const request: typeof fetch = async () => new Response(JSON.stringify({ error: reason, code: reason }), { status: status as number });
  const proxy = createAccountProxy("https://admin.test", request);
  await expect(proxy.verify("attempt", "12345678")).rejects.toMatchObject({ code });
});

it("discards the Admin token when its revocation fails", async () => {
  const account = { id: "account1", email: "fixture@example.com" };
  const request: typeof fetch = vi.fn(async (_input, init) => {
    if (init?.method === "DELETE") throw new Error("Fixture Admin is unavailable.");
    return new Response(JSON.stringify({ cloudContractVersion: 1, accessToken: `omc_${"a".repeat(43)}`, expiresAt: 1000, device: { id: "device1" }, account }));
  });
  const proxy = createAccountProxy("https://admin.test", request, () => 0);
  await expect(proxy.verify("attempt", "12345678")).resolves.toEqual(account);
  expect(vi.mocked(request).mock.calls[1]![1]).toMatchObject({ method: "DELETE", body: "{}", redirect: "error" });
});

it("rejects a malformed Admin start response", async () => {
  const request: typeof fetch = async () => new Response(JSON.stringify({ cloudContractVersion: 2, attempt: "invalid" }));
  await expect(createAccountProxy("https://admin.test", request).start("fixture@example.com")).rejects.toBeInstanceOf(AccountError);
});
