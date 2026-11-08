import { createPrivateKey, createPublicKey, sign, verify, type JsonWebKeyInput } from "node:crypto";

export type JwtAlgorithm = "RS256" | "ES256";
type ObjectValue = Record<string, unknown>;
const invalid = () => new Error("Invalid identity token.");
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as ObjectValue;
}
function decode(part: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw invalid();
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw invalid();
  return bytes;
}
export function decodeJws(token: string) {
  if (typeof token !== "string" || token.length > 65_536) throw invalid();
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid();
  const header = object(JSON.parse(decode(parts[0]!).toString("utf8")));
  const claims = object(JSON.parse(decode(parts[1]!).toString("utf8")));
  if (header.crit !== undefined || header.b64 !== undefined) throw invalid();
  return { header, claims, input: Buffer.from(`${parts[0]}.${parts[1]}`), signature: decode(parts[2]!) };
}
export async function fetchJson(request: typeof fetch, url: string, init: RequestInit = {}): Promise<ObjectValue> {
  const response = await request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok || Number(response.headers.get("content-length")) > 65_536) { await response.body?.cancel(); throw new Error("Provider request failed."); }
  if (!response.body) throw new Error("Empty provider response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65_536) throw new Error("Provider response too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
export interface JwtOptions { jwksUrl: string; issuers: string[]; clientId: string; nonce: string; algorithms: JwtAlgorithm[] }
export function createJwtVerifier(options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const request = options.fetch ?? fetch, now = options.now ?? Date.now;
  const cache = new Map<string, { keys: ObjectValue[]; fetchedAt: number; attemptedAt: number; pending?: Promise<void> }>();
  async function keys(url: string, kid: string) {
    let entry = cache.get(url);
    if (!entry) { entry = { keys: [], fetchedAt: -Infinity, attemptedAt: -Infinity }; cache.set(url, entry); }
    const current = entry;
    if (current.pending) await current.pending;
    const stale = now() - current.fetchedAt >= 3_600_000;
    if ((stale || !current.keys.some(key => key.kid === kid)) && now() - current.attemptedAt >= 60_000) {
      current.attemptedAt = now();
      current.pending = (async () => {
        const result = await fetchJson(request, url);
        if (!Array.isArray(result.keys) || result.keys.length > 100) throw invalid();
        current.keys = result.keys.map(object);
        current.fetchedAt = now();
      })();
      try { await current.pending; } finally { current.pending = undefined; }
    }
    if (now() - current.fetchedAt >= 3_600_000) throw invalid();
    return current.keys;
  }
  return async function verifyJwt(token: string, expected: JwtOptions) {
    const { header, claims, input, signature } = decodeJws(token);
    if ((header.alg !== "RS256" && header.alg !== "ES256") || !expected.algorithms.includes(header.alg)
      || typeof header.kid !== "string" || !header.kid || header.kid.length > 256) throw invalid();
    const matches = (await keys(expected.jwksUrl, header.kid)).filter(key => key.kid === header.kid);
    if (matches.length !== 1) throw invalid();
    const jwk = matches[0]!;
    if ((jwk.alg !== undefined && jwk.alg !== header.alg) || (jwk.use !== undefined && jwk.use !== "sig")
      || (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes("verify")))
      || (header.alg === "RS256" ? jwk.kty !== "RSA" : jwk.kty !== "EC" || jwk.crv !== "P-256")) throw invalid();
    const key = createPublicKey({ key: jwk as JsonWebKeyInput["key"], format: "jwk" });
    if (header.alg === "RS256" && (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw invalid();
    if (!verify("sha256", input, { key, dsaEncoding: "ieee-p1363" }, signature)) throw invalid();
    const aud = claims.aud, time = now() / 1000;
    if (typeof claims.iss !== "string" || !expected.issuers.includes(claims.iss)
      || !(typeof aud === "string" ? aud === expected.clientId : Array.isArray(aud) && aud.every(value => typeof value === "string") && aud.includes(expected.clientId))
      || (Array.isArray(aud) && claims.azp !== undefined && claims.azp !== expected.clientId)
      || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= time - 60
      || typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > time + 60
      || claims.nonce !== expected.nonce || !expected.nonce) throw invalid();
    return claims;
  };
}
export function signEs256Jwt(header: ObjectValue, claims: ObjectValue, privateKeyPem: string) {
  if (header.alg !== "ES256") throw invalid();
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw invalid();
  const input = [header, claims].map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
  return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
