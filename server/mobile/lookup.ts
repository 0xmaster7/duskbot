// The typed code's relay lookup (shared/mobile-link.ts): a sealed copy of the QR payload the phone finds by the code.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { MOBILE_LOOKUP_SALT } from "../../shared/mobile-link.ts";
import { normalizePairingCode } from "../sessions.ts";

const derive = (code: string, info: string, bytes: number) =>
  Buffer.from(hkdfSync("sha256", normalizePairingCode(code), MOBILE_LOOKUP_SALT, info, bytes));

export function lookupKeys(code: string): { id: string; key: Buffer } {
  return { id: derive(code, "lookup", 16).toString("hex"), key: derive(code, "seal", 32) };
}

export function sealLookup(code: string, payload: unknown): { id: string; sealed: string } {
  const { id, key } = lookupKeys(code);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(id));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return { id, sealed: Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url") };
}

export function openLookup(code: string, sealed: string): unknown {
  const { id, key } = lookupKeys(code);
  const raw = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8"));
}

/** Best effort: a relay that is down or refuses only means no typed code this time. */
export async function postLookup(base: string, code: string, payload: unknown, ttlMs: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const { id, sealed } = sealLookup(code, payload);
  try {
    const response = await fetchImpl(`${base}/v1/lookups`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, sealed, ttlS: Math.max(30, Math.min(900, Math.floor(ttlMs / 1000))) }),
      signal: AbortSignal.timeout(4000),
    });
    await response.text().catch(() => "");
    return response.status === 201;
  } catch {
    return false;
  }
}
