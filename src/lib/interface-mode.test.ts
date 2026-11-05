import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("interface mode", () => {
  it("is the one Simple layout, whatever an older release stored", async () => {
    vi.resetModules();
    values.set("omb-skin", "lagoon");
    values.set("omb-advanced-mode", "1");
    const { readAdvancedMode, settleAdvancedModeDefault, setAdvancedMode, ADVANCED_MODE_KEY } = await import("./interface-mode");
    settleAdvancedModeDefault();
    setAdvancedMode(true);
    expect(readAdvancedMode()).toBe(false);
    expect(values.get(ADVANCED_MODE_KEY), "the old choice is left as it was").toBe("1");
  });
});
