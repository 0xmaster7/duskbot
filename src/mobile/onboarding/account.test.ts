import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AccountError, appStartUrl, codeChallenge, finishAccountSignIn, parseAuthLink } from "./account";
import type { MobilePlatform } from "../platform";

function fakePlatform(): MobilePlatform {
  const prefs = new Map<string, string>();
  const secrets = new Map<string, string>();
  return {
    kind: "android", native: true, appVersion: "1.0", haptic: () => {}, deviceName: () => "Pixel 9",
    prefs: { get: async (k) => prefs.get(k) ?? null, set: async (k, v) => { prefs.set(k, v); }, remove: async (k) => { prefs.delete(k); } },
    secrets: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => { secrets.set(k, v); }, remove: async (k) => { secrets.delete(k); } },
    openExternal: async () => {},
  };
}

describe("account sign-in", () => {
  it("derives the S256 challenge as base64url(sha256(verifier)), checked against node's crypto", async () => {
    const verifier = "a-verifier_with.some~chars0123456789abcdefghijklmn";
    expect(await codeChallenge(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("builds the app start url with the deep link as redirect", () => {
    const url = new URL(appStartUrl("https://accounts.test", "google", "abc", "st"));
    expect(url.pathname).toBe("/v1/auth/app/start");
    expect(Object.fromEntries(url.searchParams)).toEqual({ provider: "google", code_challenge: "abc", code_challenge_method: "S256", state: "st", redirect_uri: "duskbot://auth" });
  });

  it("reads the auth deep link and ignores others", () => {
    expect(parseAuthLink("duskbot://auth?code=c1&state=s1")).toEqual({ code: "c1", state: "s1" });
    expect(parseAuthLink("duskbot://auth?error=oauth_denied&state=s1")).toEqual({ error: "oauth_denied", state: "s1" });
    expect(parseAuthLink("duskbot://pair?m=x")).toBeNull();
    expect(parseAuthLink("duskbot://auth?code=c1")).toBeNull();
  });

  it("refuses a code whose state this phone did not start", async () => {
    const platform = fakePlatform();
    await platform.prefs.set("omb.mobile.accountPending", JSON.stringify({ verifier: "v", state: "mine" }));
    await expect(finishAccountSignIn(platform, "https://accounts.test", { code: "c", state: "theirs" })).rejects.toMatchObject({ code: "state" });
  });

  it("trades the code with the verifier and keeps the token in secure storage", async () => {
    const platform = fakePlatform();
    await platform.prefs.set("omb.mobile.accountPending", JSON.stringify({ verifier: "verifier-1", state: "s" }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ accessToken: "omc_x", expiresAt: 1, device: { id: "d" }, account: { id: "a", email: "e@x.y" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const grant = await finishAccountSignIn(platform, "https://accounts.test", { code: "c", state: "s" });
    expect(grant.account.email).toBe("e@x.y");
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1].body as string)).toMatchObject({ code: "c", codeVerifier: "verifier-1", deviceName: "Pixel 9", platform: "android" });
    expect(await platform.secrets.get("account.token")).toBe("omc_x");
    await expect(finishAccountSignIn(platform, "https://accounts.test", { code: "c", state: "s" })).rejects.toBeInstanceOf(AccountError);
    vi.unstubAllGlobals();
  });
});
