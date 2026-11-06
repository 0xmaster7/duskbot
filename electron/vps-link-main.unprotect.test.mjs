import { describe, expect, it } from "vitest";
import { unprotectWith } from "./vps-link-main.mjs";

describe("unprotectWith", () => {
  const sealed = `e:${Buffer.from("watch-token").toString("base64")}`;
  it("reads electron's { result } answer from async safeStorage", async () => {
    const unprotect = unprotectWith({ decrypt: async (value) => ({ shouldReEncrypt: false, result: value.toString() }) });
    expect(await unprotect(sealed)).toBe("watch-token");
  });
  it("still reads a bare string answer and plain values", async () => {
    const unprotect = unprotectWith({ decrypt: async (value) => value.toString() });
    expect(await unprotect(sealed)).toBe("watch-token");
    expect(await unprotect("p:plain")).toBe("plain");
  });
});
