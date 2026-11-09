import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseSealKey(text: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new Error("Invalid cloud seal key.");
  const key = Buffer.from(text, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== text) throw new Error("Invalid cloud seal key.");
  return key;
}

export function createSealer(key: Buffer | null) {
  if (key && key.length !== 32) throw new Error("Invalid cloud seal key.");
  return {
    seal(value: string): string {
      if (!key) return `plain.${value}`;
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
    },
    unseal(value: string): string {
      try {
        if (!key && value.startsWith("plain.")) return value.slice(6);
        const [version, iv, tag, encrypted, extra] = value.split(".");
        if (!key || version !== "v1" || extra !== undefined || iv?.length !== 16 || tag?.length !== 22 || encrypted === undefined || ![iv, tag, encrypted].every(v => /^[A-Za-z0-9_-]*$/.test(v))) throw new Error();
        if (![iv, tag, encrypted].every(v => Buffer.from(v, "base64url").toString("base64url") === v)) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
      } catch { throw new Error("Unable to unseal cloud value."); }
    },
  };
}
