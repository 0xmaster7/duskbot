// The Vault's own move to the person's Cloud: the secrets saved to the Vault (saved-secrets.ts) and the file secrets a
// bot's card wrote to its private folder (secret-vault.ts). Security: this computer hands their values only to the
// desktop's main process over the private utility port (login-handoff.ts); main seals each for My Cloud's server key
// (cloud-seal.mjs), bound to its purpose and target, and My Cloud opens it here and keeps it under its own key, as it
// keeps a secret typed there. Only My Cloud's owner may send one; no value is answered, logged or put in an event. A
// card's in-memory secretRef never moves. Each side answers a keyed fingerprint per item, never a value, for the check.
import { createHash } from "node:crypto";
import { z } from "zod";

import { fingerprint } from "./cloud-send-verify.ts";
import type { CardSealer } from "./card-seal.ts";
import type { RequestAuth } from "./request-auth.ts";
import { unsealFields } from "./sealed-fields.ts";
import { SavedSecretsUnavailable } from "./saved-secrets.ts";
import type { RouteContext } from "./routes/table.ts";

/** A saved secret as the move carries it: its label, the bots that may use it, and its value. */
export interface HandedVaultSecret { label: string; bots: string[]; value: string }
/** A card's file secret: its bot, conversation and card, and the value its file holds. */
export interface HandedCardFile { bot: string; thread: string; card: string; value: string }
export interface HandedVault { secrets: HandedVaultSecret[]; files: HandedCardFile[] }

export interface VaultSources {
  /** Every saved secret with its value; empty while the key is unknown. */
  secrets(): HandedVaultSecret[];
  /** Every card file secret still kept, with its value. */
  files(): HandedCardFile[];
}

const ID = /^[\w-]{1,128}$/u;
export const VAULT_SECRET_TARGET = (label: string): string[] => [label.trim().toLowerCase()];
export const CARD_FILE_TARGET = (file: { bot: string; thread: string; card: string }): string[] => [file.bot, file.thread, file.card];

/** A saved secret's check key: its label, which a Vault holds once whatever its case, hashed so no label shows. */
export const vaultSecretKey = (label: string): string => `vault-secret:${createHash("sha256").update(label.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
/** A card file's check key names its bot, so a check leaves out one whose bot was removed on My Cloud. */
export const cardFileKey = (file: { bot: string; thread: string; card: string }): string => `card-secret:${file.bot}:${file.thread}:${file.card}`;

/** Each Vault item, by its check key, as a fingerprint under `nonce`: never a value. */
export function vaultFingerprints(nonce: string, sources: VaultSources): Record<string, string> {
  const out: Record<string, string> = {};
  let secrets: HandedVaultSecret[] = [];
  try { secrets = sources.secrets(); } catch { secrets = []; }
  for (const secret of secrets) out[vaultSecretKey(secret.label)] = fingerprint(nonce, { value: secret.value });
  for (const file of sources.files()) out[cardFileKey(file)] = fingerprint(nonce, { value: file.value });
  return out;
}

/** The private port's answer to `{ kind: "vault" }`: every Vault item with its value, for main to seal for My Cloud. */
export function answerVaultHandoff(sources: VaultSources): { ok: true; vault: HandedVault } | { ok: false; error: string } {
  try {
    return { ok: true, vault: { secrets: sources.secrets(), files: sources.files() } };
  } catch (error) {
    if (error instanceof SavedSecretsUnavailable) return { ok: false, error: error.message };
    return { ok: false, error: "The Vault could not be read on this computer." };
  }
}

export interface VaultMoveDeps {
  sealer: CardSealer;
  /** My Cloud's owner, or null: only the owner sends their Vault in. */
  owner(auth: RequestAuth): unknown;
  /** Keeps a saved secret under this server's own key: the same label replaces its value and adds the bots. */
  keepSecret(secret: { label: string; bots: string[]; value: string }): void;
  /** Writes a card's file secret into that bot's private folder here; false when the card is not here. */
  keepFile(file: HandedCardFile): boolean;
  bot(id: string): boolean;
}

const secretSchema = z.object({ label: z.string().trim().min(1).max(80), bots: z.array(z.string().regex(ID)).min(1).max(200), sealed: z.unknown() }).strict();
const fileSchema = z.object({ bot: z.string().regex(ID), thread: z.string().regex(ID), card: z.string().regex(ID), sealed: z.unknown() }).strict();
const VALUE_MAX = 4_096;

/** POST /api/cloud-send/vault/secret and /vault/file, on the person's own Cloud; false when the path is not this route. */
export async function vaultMoveRoute(deps: VaultMoveDeps, { req, res, path, method, auth, json, readBody }: RouteContext): Promise<boolean> {
  if (path !== "/api/cloud-send/vault/secret" && path !== "/api/cloud-send/vault/file") return false;
  res.setHeader("cache-control", "no-store");
  if (method !== "POST") { json(res, 405, { error: "method not allowed" }); return true; }
  if (!deps.owner(auth)) { req.resume(); json(res, 403, { error: "Only My Cloud's owner can move their Vault into it." }); return true; }
  const raw = await readBody(req, 64 * 1024);
  // A value travels only sealed: unsealFields refuses a plain one from anything but this server's own app.
  if (path === "/api/cloud-send/vault/secret") {
    const body = secretSchema.safeParse(raw);
    if (!body.success || body.data.sealed === undefined) { json(res, 400, { error: "send { label, bots, sealed }" }); return true; }
    const bots = body.data.bots.filter((id) => deps.bot(id));
    if (!bots.length) { json(res, 409, { error: "None of this secret's bots are on My Cloud." }); return true; }
    const opened = await unsealFields({ sealed: body.data.sealed }, { auth, sealer: deps.sealer, purpose: "vault.secret", target: VAULT_SECRET_TARGET(body.data.label), fields: ["value"] });
    if (!opened.ok) { json(res, opened.status, opened.body); return true; }
    const value = typeof opened.body.value === "string" ? opened.body.value : "";
    if (!value || Buffer.byteLength(value) > VALUE_MAX) { json(res, 400, { error: "The sealed value is not valid." }); return true; }
    try { deps.keepSecret({ label: body.data.label, bots, value }); }
    catch (error) {
      if (error instanceof SavedSecretsUnavailable) { json(res, 503, { error: error.message }); return true; }
      console.warn(`vault move: a secret could not be kept: ${error instanceof Error ? error.name : "error"}`);
      json(res, 500, { error: "My Cloud could not keep this secret safely." });
      return true;
    }
    json(res, 200, { v: 1, kept: true });
    return true;
  }
  const body = fileSchema.safeParse(raw);
  if (!body.success || body.data.sealed === undefined) { json(res, 400, { error: "send { bot, thread, card, sealed }" }); return true; }
  const { bot, thread, card } = body.data;
  if (!deps.bot(bot)) { json(res, 409, { error: "This bot is not on My Cloud yet." }); return true; }
  const opened = await unsealFields({ sealed: body.data.sealed }, { auth, sealer: deps.sealer, purpose: "card.secret", target: CARD_FILE_TARGET({ bot, thread, card }), fields: ["value"] });
  if (!opened.ok) { json(res, opened.status, opened.body); return true; }
  const value = typeof opened.body.value === "string" ? opened.body.value : "";
  if (!value || Buffer.byteLength(value) > VALUE_MAX) { json(res, 400, { error: "The sealed value is not valid." }); return true; }
  let kept: boolean;
  try { kept = deps.keepFile({ bot, thread, card, value }); }
  catch (error) {
    console.warn(`vault move: a card's secret file could not be kept: ${error instanceof Error ? error.name : "error"}`);
    json(res, 500, { error: "My Cloud could not keep this secret file safely." });
    return true;
  }
  if (!kept) { json(res, 409, { error: "This card's conversation is not on My Cloud yet." }); return true; }
  json(res, 200, { v: 1, kept: true });
  return true;
}
