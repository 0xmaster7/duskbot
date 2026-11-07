// Security: from any client but this computer's own app (loopback, or the desktop's private channel) a password, a 2FA
// key, a 1Password token or an API key arrives only sealed for this server process (server/card-seal.ts), so whatever
// relays the request never carries it in the clear. Sealed values are opened here and merged into the body; a plain one
// from a session is refused with `seal_required` and the key to seal for.
import { configSecrets, CONFIG_SECRET_MAPS, CONFIG_SECRET_PATHS, type SealPurpose } from "../shared/saved-secrets.ts";
import { CardSealError, sealedCardSecret, type CardSealer } from "./card-seal.ts";
import type { RequestAuth } from "./request-auth.ts";

export type Unsealed = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> };

export const SEAL_REQUIRED = "Seal the secret for this server before sending it. Update the app and try again.";

const plainSecret = (value: unknown) => typeof value === "string" && value.length > 0;

function refusal(error: unknown): Unsealed {
  if (error instanceof CardSealError) return { ok: false, status: error.status, body: { error: error.message, ...(error.sealKey ? { sealKey: error.sealKey } : {}) } };
  throw error;
}

/** The body with its sealed `fields` opened, or the answer that refuses it. */
export async function unsealFields(
  body: Record<string, unknown>,
  options: { auth: RequestAuth; sealer: CardSealer; purpose: SealPurpose; target: readonly string[]; fields: readonly string[] },
): Promise<Unsealed> {
  const { sealed: raw, ...rest } = body;
  if (raw === undefined) {
    if (options.auth.kind !== "loopback" && options.fields.some((field) => plainSecret(rest[field]))) {
      return { ok: false, status: 400, body: { error: SEAL_REQUIRED, code: "seal_required", sealKey: options.sealer.publicKey() } };
    }
    return { ok: true, body: rest };
  }
  const sealed = sealedCardSecret(raw);
  if (!sealed) return { ok: false, status: 400, body: { error: "The sealed value is invalid." } };
  if (options.fields.some((field) => rest[field] !== undefined && rest[field] !== null && rest[field] !== "")) {
    return { ok: false, status: 400, body: { error: "Send each secret sealed or plain, not both." } };
  }
  try {
    return { ok: true, body: { ...rest, ...await options.sealer.openValues(sealed, options.purpose, options.target, options.fields) } };
  } catch (error) {
    return refusal(error);
  }
}

const PATH_PART = /^(?!__proto__$|constructor$|prototype$)[\w-]{1,128}$/u;

function allowedConfigPath(path: string): boolean {
  if ((CONFIG_SECRET_PATHS as readonly string[]).includes(path)) return true;
  return CONFIG_SECRET_MAPS.some((map) => path.startsWith(`${map}.`) && PATH_PART.test(path.slice(map.length + 1)));
}

/** A settings patch with its sealed keys put back where `sealedPaths` says; plain keys only from loopback. */
export async function unsealConfig(body: unknown, options: { auth: RequestAuth; sealer: CardSealer }): Promise<Unsealed> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: true, body: body as Record<string, unknown> };
  const { sealed: raw, sealedPaths, ...rest } = body as Record<string, unknown>;
  const plain = configSecrets(rest);
  if (raw === undefined) {
    if (options.auth.kind !== "loopback" && plain.size) return { ok: false, status: 400, body: { error: SEAL_REQUIRED, code: "seal_required", sealKey: options.sealer.publicKey() } };
    return { ok: true, body: rest };
  }
  const sealed = sealedCardSecret(raw);
  if (!sealed) return { ok: false, status: 400, body: { error: "The sealed value is invalid." } };
  if (!Array.isArray(sealedPaths) || !sealedPaths.length || sealedPaths.length > 64 || !sealedPaths.every((path) => typeof path === "string" && allowedConfigPath(path))) {
    return { ok: false, status: 400, body: { error: "sealedPaths must name the settings the sealed value holds." } };
  }
  const paths = [...new Set(sealedPaths as string[])].sort();
  if (paths.some((path) => plain.has(path))) return { ok: false, status: 400, body: { error: "Send each secret sealed or plain, not both." } };
  let values: Record<string, string>;
  try { values = await options.sealer.openValues(sealed, "config", paths, paths); } catch (error) { return refusal(error); }
  if (Object.keys(values).length !== paths.length) return { ok: false, status: 400, body: { error: "The sealed value is not valid." } };
  const merged: Record<string, unknown> = { ...rest };
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    let node = merged;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      node = node[part] = next && typeof next === "object" && !Array.isArray(next) ? { ...next as Record<string, unknown> } : {};
    }
    node[parts.at(-1)!] = value;
  }
  return { ok: true, body: merged };
}
