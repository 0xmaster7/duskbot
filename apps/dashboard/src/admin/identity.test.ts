import { describe, expect, it } from "vitest";
import { identity } from "./identity";
import { friendlyName } from "./names";

describe("identity", () => {
  it("never shows a placeholder name", () => {
    expect(identity({ id: "acct_1", name: "account", email: "a@b.test" })).toEqual({ name: "a@b.test", sub: null, anonymous: false });
    expect(identity({ id: "acct_1", name: "  ", email: "a@b.test" }).name).toBe("a@b.test");
  });
  it("puts a real name first with the email under it", () => {
    expect(identity({ id: "acct_1", name: "Ana Ferreira", email: "ana@x.test" })).toEqual({ name: "Ana Ferreira", sub: "ana@x.test", anonymous: false });
  });
  it("gives an anonymous visitor their stable animal name", () => {
    expect(identity({ id: "visitor123" })).toEqual({ name: friendlyName("visitor123"), sub: null, anonymous: true });
  });
});
