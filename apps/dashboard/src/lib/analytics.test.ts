import { describe, expect, it } from "vitest";
import { slug } from "./analytics";

describe("slug", () => {
  it("turns a static name into an analytics word", () => {
    expect(slug("  Download for Mac ")).toBe("download_for_mac");
    expect(slug("start your free trial today now")).toBe("start_your_free_trial");
  });
  it("drops what looks typed or like an id", () => {
    expect(slug("me@example.com")).toBeNull();
    expect(slug("order 12345")).toBeNull();
    expect(slug("ws_abcdef")).toBeNull();
    expect(slug("   ")).toBeNull();
    expect(slug(null)).toBeNull();
  });
});
