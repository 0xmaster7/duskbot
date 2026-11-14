import { describe, expect, it, vi } from "vitest";
import { cleanTranscript, cleanupWanted } from "./cleanup";
import { providerReady, providerRunsOn, resolveEngine, systemEngineWhere, type VoiceDevice } from "./engines";
import { DEFAULT_VOICE_PREFS, parseVoicePrefs, type VoicePrefs } from "./prefs";
import { joinDictation, previewText, PREVIEW_MAX_CHARS } from "./preview";
import { voiceShortcut } from "./shortcut";

const prefs = (change: Partial<VoicePrefs> = {}): VoicePrefs => ({ ...DEFAULT_VOICE_PREFS, ...change });
const mac: VoiceDevice = { kind: "desktop", os: "mac", system: "apple-speech", providers: true };
const windows: VoiceDevice = { kind: "desktop", os: "windows", system: "windows-speech", providers: true };
const iphone: VoiceDevice = { kind: "phone", os: "ios", system: "phone-native", providers: true };
const browser: VoiceDevice = { kind: "browser", system: "web-speech", providers: false };

describe("which engine listens", () => {
  it("uses the device's own recognizer by default, with no setup", () => {
    expect(resolveEngine(prefs(), mac, {})).toEqual({ kind: "system", engine: "apple-speech" });
    expect(resolveEngine(prefs(), windows, {})).toEqual({ kind: "system", engine: "windows-speech" });
    expect(resolveEngine(prefs(), iphone, {})).toEqual({ kind: "system", engine: "phone-native" });
    expect(resolveEngine(prefs(), browser, {})).toEqual({ kind: "system", engine: "web-speech" });
  });

  it("uses a chosen service once its key is saved on this device", () => {
    expect(resolveEngine(prefs({ engine: "elevenlabs" }), mac, { elevenlabs: true })).toEqual({ kind: "provider", provider: "elevenlabs" });
    expect(resolveEngine(prefs({ engine: "groq" }), iphone, { groq: true })).toEqual({ kind: "provider", provider: "groq" });
  });

  it("falls back to the built-in one, saying why, while a chosen service is not set up or cannot run here", () => {
    expect(resolveEngine(prefs({ engine: "openai" }), mac, {})).toEqual({ kind: "system", engine: "apple-speech", fellBack: "not-set-up" });
    expect(resolveEngine(prefs({ engine: "openai" }), browser, { openai: true })).toEqual({ kind: "system", engine: "web-speech", fellBack: "not-here" });
    expect(resolveEngine(prefs({ engine: "whisper-cpp", whisperCpp: { binary: "/b", model: "/m" } }), iphone, {}))
      .toEqual({ kind: "system", engine: "phone-native", fellBack: "not-here" });
  });

  it("has nothing to offer where there is no recognizer and no service", () => {
    expect(resolveEngine(prefs(), { kind: "browser", system: null, providers: false }, {})).toEqual({ kind: "none", reason: "no-recognizer" });
    expect(resolveEngine(prefs({ engine: "deepgram" }), { kind: "desktop", os: "linux", system: null, providers: true }, {}))
      .toEqual({ kind: "none", reason: "no-recognizer" });
  });

  it("knows what setting a service up means for each kind", () => {
    expect(providerReady("whisper-cpp", prefs({ whisperCpp: { binary: "/usr/local/bin/whisper-cli", model: "" } }), {})).toBe(false);
    expect(providerReady("whisper-cpp", prefs({ whisperCpp: { binary: "/usr/local/bin/whisper-cli", model: "/m.bin" } }), {})).toBe(true);
    // a gateway on this computer may take no key at all
    expect(providerReady("openai-compatible", prefs({ compatBaseUrl: "http://127.0.0.1:8317/v1" }), {})).toBe(true);
    expect(providerReady("deepgram", prefs(), { deepgram: false })).toBe(false);
    expect(providerRunsOn("whisper-cpp", windows)).toBe(true);
    expect(providerRunsOn("assemblyai", browser)).toBe(false);
  });

  it("names the device for the first-run sheet", () => {
    expect([mac, windows, iphone, browser, { kind: "phone", os: "android", system: null, providers: true } as VoiceDevice].map(systemEngineWhere))
      .toEqual(["mac", "windows", "iphone", "browser", "android"]);
  });
});

describe("the one-line preview", () => {
  it("shows a short transcript whole", () => {
    expect(previewText("  hello   there ")).toBe("hello there");
  });

  it("keeps only the latest words of a long one, cut at a word", () => {
    const said = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen";
    const shown = previewText(said, 40);
    expect(shown.startsWith("…")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(40);
    expect(said.endsWith(shown.slice(1))).toBe(true);
    expect(said.split(" ")).toContain(shown.slice(1).split(" ")[0]);
  });

  it("cuts an unspaced script by characters", () => {
    const said = "あ".repeat(PREVIEW_MAX_CHARS + 30);
    const shown = previewText(said);
    expect(shown).toBe(`…${"あ".repeat(PREVIEW_MAX_CHARS - 1)}`);
  });

  it("joins landed words to the draft with one space", () => {
    expect(joinDictation("", "hi")).toBe("hi");
    expect(joinDictation("typed", "said")).toBe("typed said");
    expect(joinDictation("typed\n", "said")).toBe("typed\nsaid");
    expect(joinDictation("typed", "  ")).toBe("typed");
  });
});

describe("the clean-up pass", () => {
  const on = { cleanup: { on: true, instanceId: "claude", model: "haiku" } };
  const off = { cleanup: { on: false, instanceId: "", model: "" } };
  const said = "um so I think we should uh ship it on friday";

  it("is off by default and then never asks a model", async () => {
    expect(DEFAULT_VOICE_PREFS.cleanup.on).toBe(false);
    const request = vi.fn();
    await expect(cleanTranscript(said, off, request)).resolves.toBe(said);
    expect(request).not.toHaveBeenCalled();
  });

  it("asks the chosen connection and model when on, and uses the tidied words", async () => {
    const request = vi.fn().mockResolvedValue({ text: "I think we should ship it on Friday." });
    await expect(cleanTranscript(said, on, request)).resolves.toBe("I think we should ship it on Friday.");
    expect(request).toHaveBeenCalledWith({ text: said, instanceId: "claude", model: "haiku" }, undefined);
  });

  it("keeps the heard words when the model fails, answers nothing, or rewrites far beyond them", async () => {
    await expect(cleanTranscript(said, on, vi.fn().mockRejectedValue(new Error("offline")))).resolves.toBe(said);
    await expect(cleanTranscript(said, on, vi.fn().mockResolvedValue({ text: "  " }))).resolves.toBe(said);
    await expect(cleanTranscript(said, on, vi.fn().mockResolvedValue({ text: "Sure! ".repeat(40) }))).resolves.toBe(said);
  });

  it("skips words too short to tidy", () => {
    expect(cleanupWanted(on, "yes")).toBe(false);
    expect(cleanupWanted(on, said)).toBe(true);
  });
});

describe("stored voice settings", () => {
  it("reads a damaged document as the defaults", () => {
    expect(parseVoicePrefs(null)).toEqual(DEFAULT_VOICE_PREFS);
    expect(parseVoicePrefs({ engine: "wispr", language: "not a tag!", cleanup: { on: "yes" }, models: { openai: 4, nope: "x" } })).toEqual(DEFAULT_VOICE_PREFS);
  });

  it("keeps valid choices", () => {
    const read = parseVoicePrefs({ engine: "elevenlabs", language: "pt-BR", realtime: false, models: { elevenlabs: "scribe_v2" }, cleanup: { on: true, instanceId: "a", model: "b" }, firstRunSeen: true });
    expect(read).toMatchObject({ engine: "elevenlabs", language: "pt-BR", realtime: false, models: { elevenlabs: "scribe_v2" }, cleanup: { on: true, instanceId: "a", model: "b" }, firstRunSeen: true });
  });
});

describe("the voice shortcut", () => {
  const press = (init: Partial<KeyboardEvent>) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "d", code: "KeyD", repeat: false, ...init });
  it("is ⌘⇧D on a Mac and Ctrl+Shift+D elsewhere", () => {
    expect(voiceShortcut(press({ metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(voiceShortcut(press({ ctrlKey: true, shiftKey: true }), true)).toBe(false);
    expect(voiceShortcut(press({ ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(voiceShortcut(press({ ctrlKey: true, shiftKey: true, repeat: true }), false)).toBe(false);
    expect(voiceShortcut(press({ metaKey: true }), true)).toBe(false);
  });
});
