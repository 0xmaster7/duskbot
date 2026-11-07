// The key a person's app seals a card secret for, so a value typed on the Mac or a phone for a server reached through
// a relay (the VPS link tunnel, a Cloud's proxy) is opened only by this server process. It is made fresh each start and
// never written anywhere; an app that sealed for an older one is told the new one and seals again.
import { generateKeyPairSync, type webcrypto } from "node:crypto";
import type { CipherSuite } from "@hpke/core";

import { CARD_SECRET_INFO, cardSecretAAD, type CardSealKey, type SealedCardSecret } from "../shared/saved-secrets.ts";
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

export function createCardSealer() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.privateKey.export({ format: "jwk" }) as webcrypto.JsonWebKey;
  const keyId = phoneSecretKeyIdFromJwk(jwk)!;
  const publicKey: CardSealKey = { version: 1, keyId, x: jwk.x!, y: jwk.y! };
  const recipient = suite().then((cipher) => cipher.kem.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true, key_ops: ["deriveBits"] }, false));

  return {
    publicKey: () => publicKey,
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
