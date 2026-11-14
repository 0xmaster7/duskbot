import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { VoiceDevice } from "@/lib/voice-input/engines";
import type { InstanceInfo } from "@/state/store";
import { cleanupConnections, engineNote, engineOptions, micStateFrom, VoiceKeyField } from "./VoiceInputSettings";

const mac: VoiceDevice = { kind: "desktop", os: "mac", system: "apple-speech", providers: true };
const remoteMac: VoiceDevice = { ...mac, providers: false };
const iphone: VoiceDevice = { kind: "phone", os: "ios", system: "phone-native", providers: true };
const browser: VoiceDevice = { kind: "browser", system: "web-speech", providers: false };

beforeEach(() => setLocale("en"));

describe("Settings > Voice", () => {
  it("names the built-in engine for the device and lists only the services that run there", () => {
    const desktop = engineOptions(mac, "system");
    expect(desktop[0]).toEqual({ value: "system", label: "Built-in (Mac)" });
    expect(desktop.map((option) => option.value)).toContain("whisper-cpp");
    const phone = engineOptions(iphone, "system");
    expect(phone[0]!.label).toBe("Built-in (iPhone)");
    expect(phone.map((option) => option.value)).not.toContain("whisper-cpp");
    expect(engineOptions(browser, "system")).toEqual([{ value: "system", label: "Built-in (browser)" }]);
    // a service picked elsewhere stays visible as the choice, with the note saying it is not used here
    expect(engineOptions(iphone, "whisper-cpp").map((option) => option.value)).toContain("whisper-cpp");
  });

  it("says when the chosen service is not set up, cannot run here, or the browser needs the app", () => {
    expect(engineNote({ kind: "system", engine: "apple-speech", fellBack: "not-set-up" }, { engine: "openai" }, mac)).toBe("OpenAI isn't set up yet, so the built-in one is used for now.");
    expect(engineNote({ kind: "system", engine: "phone-native", fellBack: "not-here" }, { engine: "whisper-cpp" }, iphone)).toContain("can't run on this device");
    expect(engineNote({ kind: "system", engine: "apple-speech", fellBack: "not-here" }, { engine: "openai" }, remoteMac)).toContain("shows another computer");
    expect(engineNote({ kind: "system", engine: "web-speech" }, { engine: "system" }, browser)).toContain("need the dusk bot desktop or phone app");
    expect(engineNote({ kind: "none", reason: "no-recognizer" }, { engine: "system" }, mac)).toContain("no built-in speech recognition");
    expect(engineNote({ kind: "provider", provider: "openai" }, { engine: "openai" }, mac)).toBeNull();
    expect(engineNote({ kind: "system", engine: "apple-speech" }, { engine: "system" }, mac)).toBeNull();
  });

  it("offers clean-up only on connections that can write", () => {
    const base = { driverKind: "codex", displayName: "Codex", models: { default: "m", options: [] }, snapshot: { state: "available" } } as unknown as InstanceInfo;
    const instances = [
      { ...base, instanceId: "ok" },
      { ...base, instanceId: "down", snapshot: { state: "unavailable" } },
      { ...base, instanceId: "mute", capabilities: { backgroundText: false } },
      { ...base, instanceId: "blocked", policy: { organizationName: "Org", reason: "no" } },
    ] as InstanceInfo[];
    expect(cleanupConnections(instances).map((instance) => instance.instanceId)).toEqual(["ok"]);
  });

  it("reads the desktop's and the browser's microphone words alike", () => {
    expect(["granted", "denied", "restricted", "not-determined", "prompt", "weird", undefined].map(micStateFrom))
      .toEqual(["granted", "denied", "denied", "prompt", "prompt", "unknown", "unknown"]);
  });

  it("asks for a key in a labelled password field, and once saved shows only that it is saved", () => {
    vi.stubGlobal("window", { duskDesktop: undefined });
    try {
      const empty = renderToStaticMarkup(createElement(VoiceKeyField, { provider: "openai", saved: false }));
      expect(empty).toContain('type="password"');
      expect(empty).toMatch(/<label id="[^"]+" for="([^"]+)"[^>]*>OpenAI key<\/label>/);
      expect(empty).toContain("Get a key");
      expect(empty).not.toContain("Saved");
      const saved = renderToStaticMarkup(createElement(VoiceKeyField, { provider: "openai", saved: true }));
      expect(saved).not.toContain("<input");
      expect(saved).toContain("Saved");
      expect(saved).toContain("data-voice-key-replace");
      expect(saved).toContain("data-voice-key-remove");
      expect(renderToStaticMarkup(createElement(VoiceKeyField, { provider: "openai-compatible", saved: false, optional: true }))).toContain("Key (optional)");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
