import { describe, expect, it } from "vitest";

import { browserNeedsAutoInstall } from "./status.ts";

const fresh = {
  enabled: true, engine: "agent-browser" as const, status: { kind: "unavailable", installable: true },
  installing: false, failed: false, sealedTest: false, optedOut: false,
};

describe("the built-in browser on a fresh workspace", () => {
  it("installs its engine by itself when it is missing, so This Mac's bots have a browser with no setup", () => {
    expect(browserNeedsAutoInstall(fresh)).toBe(true);
  });

  it("leaves it when it is there, switched off, on the new engine, already installing, failed once, opted out or in a sealed test", () => {
    expect(browserNeedsAutoInstall({ ...fresh, status: { kind: "ready" } })).toBe(false);
    expect(browserNeedsAutoInstall({ ...fresh, status: { kind: "unavailable", installable: false } })).toBe(false);
    expect(browserNeedsAutoInstall({ ...fresh, enabled: false })).toBe(false);
    expect(browserNeedsAutoInstall({ ...fresh, engine: "chrome" })).toBe(false);
    expect(browserNeedsAutoInstall({ ...fresh, installing: true })).toBe(false);
    expect(browserNeedsAutoInstall({ ...fresh, failed: true })).toBe(false);
    expect(browserNeedsAutoInstall({ ...fresh, optedOut: true })).toBe(false);
    expect(browserNeedsAutoInstall({ ...fresh, sealedTest: true })).toBe(false);
  });
});
