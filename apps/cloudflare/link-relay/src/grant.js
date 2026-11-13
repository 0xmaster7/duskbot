// the link grant format and keys of apps/link-service/src/grant.mjs, verified with webcrypto
export const GRANT_PREFIX = "l1";
export const GRANT_MAX_TTL_MS = 15 * 60_000;
export const GRANT_SKEW_MS = 2 * 60_000;
export const PINNED_GRANT_KEYS = Object.freeze([{ kid: "ent-2026-11", x: "h4GwuuVu6HGLupu68zCsKbN2CWf7lt0cCNxBjWIZ-HI" }]);

const KID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const ACCT = /^[0-9a-f]{32}$/;

export function fromB64url(text) {
  const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  const out = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i += 1) out[i] = plain.charCodeAt(i);
  return out;
}

/** `kid:x,kid:x` (the GRANT_KEYS var): the keys to trust instead of the pinned ones */
export function parseGrantKeys(value) {
  if (!value?.trim()) return null;
  return value.split(",").map((item) => {
    const [kid, x] = item.trim().split(":");
    if (!kid || !x || !KID.test(kid) || !B64URL.test(x) || fromB64url(x).length !== 32) throw new Error("GRANT_KEYS must be kid:x pairs of Ed25519 public keys");
    return { kid, x };
  });
}

/** @returns {Promise<{ ok: true, acct: string } | { ok: false, error: string }>} */
export async function verifyLinkGrant(token, { keys = PINNED_GRANT_KEYS, now = Date.now() } = {}) {
  if (typeof token !== "string" || token.length > 1024) return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== GRANT_PREFIX || !KID.test(parts[1]) || !B64URL.test(parts[2]) || !B64URL.test(parts[3])) return { ok: false, error: "malformed" };
  const known = keys.find((one) => one.kid === parts[1]);
  if (!known) return { ok: false, error: "unknown_key" };
  let good = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: known.x }, { name: "Ed25519" }, false, ["verify"]);
    good = await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(parts[3]), new TextEncoder().encode(`${parts[0]}.${parts[1]}.${parts[2]}`));
  } catch { good = false; }
  if (!good) return { ok: false, error: "bad_signature" };
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[2]))); } catch { return { ok: false, error: "malformed" }; }
  if (!claims || claims.v !== 1 || claims.aud !== "link" || typeof claims.acct !== "string" || !ACCT.test(claims.acct) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) {
    return { ok: false, error: "malformed" };
  }
  if (claims.exp - claims.iat > GRANT_MAX_TTL_MS) return { ok: false, error: "too_long" };
  if (claims.iat - GRANT_SKEW_MS > now) return { ok: false, error: "not_yet_valid" };
  if (claims.exp + GRANT_SKEW_MS <= now) return { ok: false, error: "expired" };
  return { ok: true, acct: claims.acct };
}
