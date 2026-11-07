import { CARD_SECRET_INFO, cardSecretAAD, type CardSealKey, type SealedCardSecret } from "../../shared/saved-secrets.ts";

// Security: a card secret leaves this app only sealed for the server that keeps it, so the relay between them (the VPS
// link tunnel, a Cloud's proxy) never carries it in the clear.

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

export async function sealCardSecret(
  value: string,
  key: CardSealKey,
  context: { botId: string; threadId: string; messageId: string; requestKey: string; remember: boolean },
): Promise<SealedCardSecret> {
  const { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } = await import("@hpke/core");
  const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
  const recipientPublicKey = await suite.kem.importKey("jwk", { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true, key_ops: [] }, true);
  const plain = new TextEncoder().encode(value);
  try {
    const sealed = await suite.seal({ recipientPublicKey, info: new TextEncoder().encode(CARD_SECRET_INFO) }, plain, cardSecretAAD({ keyId: key.keyId, ...context }));
    return { keyId: key.keyId, encapsulatedKey: b64url(sealed.enc), ciphertext: b64url(sealed.ct) };
  } finally {
    plain.fill(0);
  }
}
