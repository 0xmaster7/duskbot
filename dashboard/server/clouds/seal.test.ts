import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { createSealer, parseSealKey } from "./seal.ts";

it("round trips with fresh authenticated ciphertext and refuses tampering", () => {
  const key = randomBytes(32), sealer = createSealer(key), sealed = sealer.seal("private payload");
  expect(parseSealKey(key.toString("base64url"))).toEqual(key);
  expect(sealed).toMatch(/^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/);
  expect(sealed).not.toEqual(sealer.seal("private payload"));
  expect(sealer.unseal(sealed)).toBe("private payload");
  const parts = sealed.split("."); parts[3] = `${parts[3][0] === "a" ? "b" : "a"}${parts[3].slice(1)}`;
  expect(() => sealer.unseal(parts.join("."))).toThrow("Unable to unseal");
  const tagParts = sealed.split("."), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const last = alphabet.indexOf(tagParts[2].at(-1)!);
  tagParts[2] = tagParts[2].slice(0, -1) + alphabet[last + 1];
  expect(() => sealer.unseal(tagParts.join("."))).toThrow();
  expect(() => createSealer(randomBytes(32)).unseal(sealed)).toThrow();
  expect(() => sealer.unseal("plain.private payload")).toThrow();
  expect(sealer.unseal(sealer.seal(""))).toBe("");
});

it("supports explicit development plaintext and rejects malformed keys without echoing them", () => {
  const sealer = createSealer(null);
  expect(sealer.seal("value")).toBe("plain.value");
  expect(sealer.unseal("plain.value")).toBe("value");
  for (const value of ["secret", "!".repeat(43), "_".repeat(43), "a".repeat(44)]) {
    try { parseSealKey(value); expect.unreachable(); } catch (error) { expect(String(error)).not.toContain(value); }
  }
});
