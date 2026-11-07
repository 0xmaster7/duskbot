// The key a person's app seals a card secret, a login, a 1Password token or an API key for, so a value typed on the Mac
// or a phone for a server reached through a relay (the VPS link tunnel, a Cloud's proxy) is opened only by this server
// process. It is made fresh each start and never written anywhere; an app that sealed for an older one is told the new
// one and seals again. Each one is signed by the server's long-term identity key (a 0600 file in the data folder, never
// in a backup), which the desktop app pins when it links the server, so a relay cannot swap in a key of its own.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject, type webcrypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CipherSuite } from "@hpke/core";

import {
  CARD_SECRET_INFO, cardSecretAAD, SEALED_VALUE_INFO, sealedValueAAD, sealKeySigningInput,
  type CardSealKey, type SealedCardSecret, type SealPurpose,
} from "../shared/saved-secrets.ts";
import { phoneSecretKeyIdFromJwk } from "./phone-secret.ts";
import { SECRET_VALUE_MAX_BYTES } from "./secret-vault.ts";

const B64URL = /^[A-Za-z0-9_-]+$/u;

export class CardSealError extends Error {
  readonly status: number;
  readonly sealKey?: CardSealKey;
  constructor(message: string, status = 400, sealKey?: CardSealKey) {
    super(message);
    this.name = "CardSealError";
    this.status = status;
    if (sealKey) this.sealKey = sealKey;
  }
}

let hpke: Promise<CipherSuite> | undefined;
const suite = () => hpke ??= import("@hpke/core").then(({ Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 }) =>
  new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() }));

export function sealedCardSecret(value: unknown): SealedCardSecret | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { keyId, encapsulatedKey, ciphertext } = value as Record<string, unknown>;
  if (typeof keyId !== "string" || !/^[A-Za-z0-9_-]{22}$/u.test(keyId)) return null;
  if (typeof encapsulatedKey !== "string" || !/^[A-Za-z0-9_-]{87}$/u.test(encapsulatedKey)) return null;
  if (typeof ciphertext !== "string" || ciphertext.length < 23 || ciphertext.length > 5_483 || !B64URL.test(ciphertext)) return null;
  return { keyId, encapsulatedKey, ciphertext };
}

export const SEAL_IDENTITY_FILE = "seal-identity.key";

/** The identity's public half as the app pins it: `x.y`, base64url. */
export function sealIdentityOf(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: "jwk" }) as webcrypto.JsonWebKey;
  return `${jwk.x}.${jwk.y}`;
}

/** The server's long-term signing key, made once. An unreadable file is an error, never silently replaced: a new
 * identity makes every linked app refuse to seal until it is linked again. */
export function loadSealIdentity(dataDir: string): KeyObject {
  const file = join(dataDir, SEAL_IDENTITY_FILE);
  const read = (): KeyObject | null => {
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const key = createPrivateKey({ key: JSON.parse(text) as webcrypto.JsonWebKey, format: "jwk" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error(`${file} is not a P-256 key`);
    return key;
  };
  const existing = read();
  if (existing) return existing;
  const fresh = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  try {
    writeFileSync(file, JSON.stringify(fresh.export({ format: "jwk" })), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return read()!;
    throw error;
  }
  return fresh;
}

const REPLAY_MEMORY = 4096;

export function createCardSealer(options: { identity?: KeyObject } = {}) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.privateKey.export({ format: "jwk" }) as webcrypto.JsonWebKey;
  const keyId = phoneSecretKeyIdFromJwk(jwk)!;
  const identityKey = options.identity ?? generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  const identity = sealIdentityOf(identityKey);
  const unsigned = { keyId, x: jwk.x!, y: jwk.y! };
  const signature = sign("sha256", sealKeySigningInput(unsigned, identity), { key: identityKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const publicKey: CardSealKey = { version: 1, ...unsigned, identity, signature };
  const recipient = suite().then((cipher) => cipher.kem.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true, key_ops: ["deriveBits"] }, false));
  // A sealed value opens once: a relay that kept a copy cannot send it again.
  const opened = new Set<string>();

  return {
    publicKey: () => publicKey,
    identity: () => identity,
    /** Named values sealed for this process, for this purpose and target only, each at most `maxBytes`. */
    async openValues(sealed: SealedCardSecret, purpose: SealPurpose, target: readonly string[], allowed: readonly string[], maxBytes = 8192): Promise<Record<string, string>> {
      if (sealed.keyId !== keyId) throw new CardSealError("This server restarted since the app got its key. Save again.", 409, publicKey);
      if (opened.has(sealed.encapsulatedKey)) throw new CardSealError("This sealed value was already used. Nothing was saved.", 409);
      let plain: Uint8Array;
      try {
        plain = new Uint8Array(await (await suite()).open(
          { recipientKey: await recipient, enc: Buffer.from(sealed.encapsulatedKey, "base64url"), info: new TextEncoder().encode(SEALED_VALUE_INFO) },
          Buffer.from(sealed.ciphertext, "base64url"),
          sealedValueAAD(keyId, purpose, target),
        ));
      } catch {
        throw new CardSealError("The sealed value could not be verified for this change. Nothing was saved.");
      }
      opened.add(sealed.encapsulatedKey);
      if (opened.size > REPLAY_MEMORY) opened.delete(opened.values().next().value!);
      try {
        let parsed: unknown;
        try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)); } catch { parsed = null; }
        const values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { values?: unknown }).values : null;
        if (!values || typeof values !== "object" || Array.isArray(values)) throw new CardSealError("The sealed value is not valid.");
        const entries = Object.entries(values as Record<string, unknown>);
        if (!entries.length || entries.some(([name, value]) => !allowed.includes(name) || typeof value !== "string" || Buffer.byteLength(value) > maxBytes)) {
          throw new CardSealError("The sealed value is not valid.");
        }
        return Object.fromEntries(entries) as Record<string, string>;
      } finally {
        plain.fill(0);
      }
    },
    /** The value, opened only if it was sealed for this process and this card and choice. */
    async open(sealed: SealedCardSecret, context: { botId: string; threadId: string; messageId: string; requestKey: string; remember: boolean }): Promise<string> {
      if (sealed.keyId !== keyId) throw new CardSealError("This server restarted since the card opened. Save again.", 409, publicKey);
      let opened: Uint8Array;
      try {
        const plain = await (await suite()).open(
          { recipientKey: await recipient, enc: Buffer.from(sealed.encapsulatedKey, "base64url"), info: new TextEncoder().encode(CARD_SECRET_INFO) },
          Buffer.from(sealed.ciphertext, "base64url"),
          cardSecretAAD({ keyId, ...context }),
        );
        opened = new Uint8Array(plain);
      } catch {
        throw new CardSealError("The sealed secret could not be verified for this card. Nothing was saved.");
      }
      try {
        const value = new TextDecoder("utf-8", { fatal: true }).decode(opened);
        if (!value.trim() || Buffer.byteLength(value) > SECRET_VALUE_MAX_BYTES) throw new CardSealError(`Enter the secret: up to ${SECRET_VALUE_MAX_BYTES} bytes.`);
        return value;
      } catch (error) {
        if (error instanceof CardSealError) throw error;
        throw new CardSealError("The sealed secret is not valid text.");
      } finally {
        opened.fill(0);
      }
    },
  };
}

export type CardSealer = ReturnType<typeof createCardSealer>;
