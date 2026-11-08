export class UnsupportedCryptoError extends Error {
  constructor() { super("mobile.pair.unsupported"); }
}

export function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new UnsupportedCryptoError();
  return crypto.subtle;
}

export function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unbase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}

export const utf8 = (value: string) => new TextEncoder().encode(value);
export const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const randomToken = () => { subtle(); return base64url(crypto.getRandomValues(new Uint8Array(32))); };
export const sha256hex = async (value: string) => hex(new Uint8Array(await subtle().digest("SHA-256", utf8(value))));

export async function hkdf(ikm: Uint8Array, salt: string, info: string, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle().importKey("raw", new Uint8Array(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: utf8(salt), info: utf8(info) }, key, length * 8));
}

export async function seal(key: Uint8Array, aad: string, plain: Uint8Array): Promise<string> {
  const aes = await subtle().importKey("raw", new Uint8Array(key), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, aes, new Uint8Array(plain)));
  const bytes = new Uint8Array(iv.length + encrypted.length);
  bytes.set(iv);
  bytes.set(encrypted, iv.length);
  return base64url(bytes);
}

export async function unseal(key: Uint8Array, aad: string, sealed: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = unbase64(sealed);
  if (raw.length < 29) throw new Error("invalid sealed value");
  const aes = await subtle().importKey("raw", new Uint8Array(key), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: utf8(aad) }, aes, raw.slice(12)));
}

export type RelaySecrets = { priv: string; pub: string; token: string };

export async function createRelaySecrets(): Promise<RelaySecrets> {
  try {
    const keys = await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"]) as CryptoKeyPair;
    return {
      priv: base64url(new Uint8Array(await subtle().exportKey("pkcs8", keys.privateKey))),
      pub: base64url(new Uint8Array(await subtle().exportKey("raw", keys.publicKey))),
      token: randomToken(),
    };
  } catch { throw new UnsupportedCryptoError(); }
}

export async function deviceChannelKey(priv: string, agentPub: string, channel: string): Promise<Uint8Array<ArrayBuffer>> {
  let privateKey: CryptoKey, publicKey: CryptoKey;
  try {
    privateKey = await subtle().importKey("pkcs8", unbase64(priv), { name: "X25519" }, false, ["deriveBits"]);
    publicKey = await subtle().importKey("raw", unbase64(agentPub), { name: "X25519" }, false, []);
  } catch { throw new UnsupportedCryptoError(); }
  const shared = await subtle().deriveBits({ name: "X25519", public: publicKey }, privateKey, 256);
  return hkdf(new Uint8Array(shared), `omb-link-v1|${channel}`, "seal", 32);
}
