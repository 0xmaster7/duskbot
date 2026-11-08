import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { MobileDevice } from "../../shared/mobile-link";
import { newDeviceSince, platformLabelKey } from "./MobilePairingCard";

const device = (id: string, name = id): MobileDevice => ({
  id, name, platform: "ios", createdAt: 0, lastSeenAt: 0, expiresAt: 1, relay: false, push: null,
});

describe("mobile workspace pairing", () => {
  it("labels the native platforms and falls back to Phone", () => {
    expect(platformLabelKey("ios")).toBe("settings.mobile.ios");
    expect(platformLabelKey("android")).toBe("settings.mobile.android");
    expect(platformLabelKey("other")).toBe("settings.mobile.phone");
    expect(platformLabelKey("unknown")).toBe("settings.mobile.phone");
  });

  it("finds the first phone paired with an empty workspace", () => {
    const phone = device("new", "My phone");
    expect(newDeviceSince([], [phone])).toBe(phone);
  });

  it("detects a new id even when its name matches an existing phone", () => {
    const phone = device("new", "Phone");
    expect(newDeviceSince(["old"], [device("old", "Phone"), phone])).toBe(phone);
  });

  it("ignores reordering, renames and last-seen updates", () => {
    expect(newDeviceSince(["a", "b"], [
      { ...device("b", "Renamed"), lastSeenAt: 100 }, device("a"),
    ])).toBeNull();
  });

  it("does not mistake a revoked phone for a new pairing", () => {
    expect(newDeviceSince(["a", "b"], [device("b")])).toBeNull();
    expect(newDeviceSince(["a"], [])).toBeNull();
  });

  it("reports the first new phone when several arrive together", () => {
    const first = device("first");
    expect(newDeviceSince(["old"], [device("old"), first, device("second")])).toBe(first);
  });

  it("keeps the Mac companion out of remote workspace pairing", () => {
    const source = readFileSync(new URL("./MobilePairingCard.tsx", import.meta.url), "utf8");
    expect(source).toContain("const companion = remote ? null : companionBridge()");
    expect(source).toContain("request.companion = (await companion.start()).endpoints");
    expect(source).toContain('method: "POST", body: JSON.stringify(request)');
  });

  it("places mobile pairing immediately before server pairing with the active workspace flag", () => {
    const source = readFileSync(new URL("./SettingsModal.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/pairing: <>\s*<MobilePairingCard remote=\{remoteActive\} \/>\s*<ServerPairingCard/);
  });
});
