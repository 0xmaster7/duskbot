// Which recognizer hears the person: the device's own unless they picked a service in Settings > Voice and it is set up
// on this device. Pure, so the choice is testable without a microphone.
import { VOICE_PROVIDER_INFO, type VoiceProvider } from "../../../electron/voice-catalog.mjs";
import type { VoicePrefs } from "./prefs";

export type { VoiceProvider };

/** The device's own recognizers. `fish-audio` is the page recording clips that the bot's server turns into text with
 * whichever listening key is connected (Fish Audio, OpenAI, Groq, Deepgram and others): Linux's stand-in, and the
 * fallback anywhere the device's own recognizer is missing. */
export type SystemEngine = "apple-speech" | "windows-speech" | "phone-native" | "web-speech" | "fish-audio";

export type VoiceDevice =
  | { kind: "desktop"; os: "mac" | "windows" | "linux"; system: SystemEngine | null; providers: boolean }
  | { kind: "phone"; os: "ios" | "android"; system: "phone-native" | null; providers: boolean }
  | { kind: "browser"; system: "web-speech" | null; providers: false };

export type ResolvedEngine =
  | { kind: "system"; engine: SystemEngine; fellBack?: "not-set-up" | "not-here" }
  | { kind: "provider"; provider: VoiceProvider }
  | { kind: "none"; reason: "no-recognizer" };

export type KeyState = Partial<Record<VoiceProvider, boolean>>;

/** Whether this service can run on this device at all: services need the desktop or phone app, programs the desktop. */
export function providerRunsOn(provider: VoiceProvider, device: VoiceDevice): boolean {
  if (!device.providers) return false;
  return !VOICE_PROVIDER_INFO[provider].desktopOnly || device.kind === "desktop";
}

/** Whether the person finished setting this service up here: its key, or its program and model, or its address. */
export function providerReady(provider: VoiceProvider, prefs: VoicePrefs, keys: KeyState): boolean {
  if (provider === "whisper-cpp") return Boolean(prefs.whisperCpp.binary.trim() && prefs.whisperCpp.model.trim());
  if (provider === "openai-compatible") return Boolean(prefs.compatBaseUrl.trim());
  return keys[provider] === true;
}

/**
 * `serverListens`: the bot's server has a key that turns speech into text. It stands in when the device has no
 * recognizer of its own, so "none" means nothing at all here can listen.
 */
export function resolveEngine(prefs: VoicePrefs, device: VoiceDevice, keys: KeyState, serverListens = false): ResolvedEngine {
  const own = device.system && (device.system !== "fish-audio" || serverListens) ? device.system : null;
  // a phone records through its native plugin only; desktops and browsers can record in the page
  const server = serverListens && device.kind !== "phone" ? "fish-audio" : null;
  const system = (fellBack?: "not-set-up" | "not-here"): ResolvedEngine => {
    const engine = own ?? server;
    return engine ? { kind: "system", engine, ...(fellBack ? { fellBack } : {}) } : { kind: "none", reason: "no-recognizer" };
  };
  if (prefs.engine === "system") return system();
  const provider = prefs.engine;
  if (!providerRunsOn(provider, device)) return system("not-here");
  if (!providerReady(provider, prefs, keys)) return system("not-set-up");
  return { kind: "provider", provider };
}

/** The words for "your device's built-in transcription" on the first-run sheet and in Settings. */
export function systemEngineWhere(device: VoiceDevice): "mac" | "windows" | "linux" | "iphone" | "android" | "browser" {
  if (device.kind === "desktop") return device.os;
  if (device.kind === "phone") return device.os === "ios" ? "iphone" : "android";
  return "browser";
}

/** Whether this engine runs on the device itself, so the first-run sheet can say so. */
export function isSystemEngine(engine: ResolvedEngine): engine is Extract<ResolvedEngine, { kind: "system" }> {
  return engine.kind === "system";
}
