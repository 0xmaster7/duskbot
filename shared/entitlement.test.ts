import { describe, expect, it } from "vitest";
import { ENTITLEMENT_MAX_TTL_MS, ENTITLEMENT_SKEW_MS, generateEntitlementSigner, parseEntitlementKeys, parseEntitlementSigner, PINNED_ENTITLEMENT_KEYS, signEntitlement, verifyEntitlement } from "./entitlement.ts";

const CLOUD = `c${"a".repeat(24)}`, NOW = 1_800_000_000_000;
const make = (kid = "test-1") => generateEntitlementSigner(kid);
const claims = (over: Partial<Parameters<typeof signEntitlement>[0]> = {}) => ({ aud: ["home", "app"] as Array<"home" | "app">, cloud: CLOUD, acct: "a1", tier: "pro", features: ["cloud"], iat: NOW, exp: NOW + 3_600_000, ...over });

describe("signed entitlements", () => {
  it("verifies offline with the public key, for its cloud and audience", () => {
    const { signer, publicKey } = make();
    const token = signEntitlement(claims(), signer);
    const verdict = verifyEntitlement(token, { keys: [publicKey], audience: "home", cloudId: CLOUD, now: NOW + 60_000 });
    expect(verdict).toMatchObject({ ok: true, kid: "test-1", claims: { cloud: CLOUD, tier: "pro" } });
  });

  it("refuses another key, a changed payload, another cloud and another audience", () => {
    const { signer, publicKey } = make(), other = make("test-2");
    const token = signEntitlement(claims({ aud: ["app"] }), signer);
    expect(verifyEntitlement(token, { keys: [other.publicKey], audience: "app", now: NOW })).toEqual({ ok: false, error: "unknown_key" });
    expect(verifyEntitlement(token, { keys: [{ kid: "test-1", x: other.publicKey.x }], audience: "app", now: NOW })).toEqual({ ok: false, error: "bad_signature" });
    const [p, k, body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString());
    forged.tier = "team";
    expect(verifyEntitlement([p, k, Buffer.from(JSON.stringify(forged)).toString("base64url"), sig].join("."), { keys: [publicKey], audience: "app", now: NOW })).toEqual({ ok: false, error: "bad_signature" });
    expect(verifyEntitlement(token, { keys: [publicKey], audience: "home", now: NOW })).toEqual({ ok: false, error: "wrong_audience" });
    expect(verifyEntitlement(token, { keys: [publicKey], audience: "app", cloudId: `c${"b".repeat(24)}`, now: NOW })).toEqual({ ok: false, error: "wrong_cloud" });
    expect(verifyEntitlement("e1.x.y", { keys: [publicKey], audience: "app" })).toEqual({ ok: false, error: "malformed" });
  });

  it("tolerates clock skew both ways, and no more", () => {
    const { signer, publicKey } = make(), token = signEntitlement(claims(), signer), keys = [publicKey];
    expect(verifyEntitlement(token, { keys, audience: "home", now: NOW - ENTITLEMENT_SKEW_MS + 1 }).ok).toBe(true);
    expect(verifyEntitlement(token, { keys, audience: "home", now: NOW - ENTITLEMENT_SKEW_MS - 1 })).toEqual({ ok: false, error: "not_yet_valid" });
    expect(verifyEntitlement(token, { keys, audience: "home", now: NOW + 3_600_000 + ENTITLEMENT_SKEW_MS - 1 }).ok).toBe(true);
    expect(verifyEntitlement(token, { keys, audience: "home", now: NOW + 3_600_000 + ENTITLEMENT_SKEW_MS })).toEqual({ ok: false, error: "expired" });
  });

  it("rotates by key id: an old key keeps verifying while both are pinned", () => {
    const old = make("k-old"), next = make("k-new"), keys = [next.publicKey, old.publicKey];
    expect(verifyEntitlement(signEntitlement(claims(), old.signer), { keys, audience: "app", now: NOW }).ok).toBe(true);
    expect(verifyEntitlement(signEntitlement(claims(), next.signer), { keys, audience: "app", now: NOW }).ok).toBe(true);
    expect(verifyEntitlement(signEntitlement(claims(), old.signer), { keys: [next.publicKey], audience: "app", now: NOW })).toEqual({ ok: false, error: "unknown_key" });
  });

  it("never signs or accepts an over-long token", () => {
    const { signer } = make();
    expect(() => signEntitlement(claims({ exp: NOW + ENTITLEMENT_MAX_TTL_MS + 1 }), signer)).toThrow();
  });

  it("round-trips the env forms, and pins a production key", () => {
    const { env, publicKey } = make("env-1");
    expect(parseEntitlementSigner(env).kid).toBe("env-1");
    expect(parseEntitlementKeys(`${publicKey.kid}:${publicKey.x}`)).toEqual([publicKey]);
    expect(() => parseEntitlementKeys("bad")).toThrow();
    expect(() => parseEntitlementSigner("nokid")).toThrow();
    expect(PINNED_ENTITLEMENT_KEYS.length).toBeGreaterThan(0);
    for (const key of PINNED_ENTITLEMENT_KEYS) expect(Buffer.from(key.x, "base64url")).toHaveLength(32);
  });
});
