import { useSyncExternalStore } from "react";

/** Grok's voice-chat speeds, in its order. */
export const VOICE_SPEEDS = ["0.5", "0.75", "1", "1.25", "1.5", "2"] as const;
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];

/** Grok's voice-chat languages, in its order; "auto" is Auto-detect. */
export const VOICE_LANGUAGES = [
  ["auto", "Auto-detect"], ["en", "English"], ["ar-EG", "Arabic (Egypt)"], ["ar-SA", "Arabic (Saudi Arabia)"], ["ar-AE", "Arabic (United Arab Emirates)"],
  ["bn", "Bengali"], ["ca", "Catalan"], ["zh-CN", "Chinese (Simplified)"], ["da", "Danish"], ["nl", "Dutch"], ["fi", "Finnish"], ["fr", "French"],
  ["de", "German"], ["hi", "Hindi"], ["hu", "Hungarian"], ["id", "Indonesian"], ["it", "Italian"], ["ja", "Japanese"], ["ko", "Korean"], ["pl", "Polish"],
  ["pt-BR", "Portuguese (Brazil)"], ["pt-PT", "Portuguese (Portugal)"], ["ru", "Russian"], ["es-MX", "Spanish (Mexico)"], ["es-ES", "Spanish (Spain)"],
  ["sv", "Swedish"], ["th", "Thai"], ["tr", "Turkish"], ["vi", "Vietnamese"],
] as const;

export interface VoicePrefs { speed: VoiceSpeed; language: string }

const DEFAULTS: VoicePrefs = { speed: "1", language: "auto" };
const key = (botId: string) => `duskbot.voicePrefs.v1:${botId}`;
const watchers = new Set<() => void>();
const cache = new Map<string, VoicePrefs>();

function read(botId: string): VoicePrefs {
  const cached = cache.get(botId);
  if (cached) return cached;
  let prefs = DEFAULTS;
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(key(botId)) ?? "null") as Partial<VoicePrefs> | null;
    if (raw) {
      prefs = {
        speed: (VOICE_SPEEDS as readonly string[]).includes(raw.speed ?? "") ? raw.speed as VoiceSpeed : DEFAULTS.speed,
        language: VOICE_LANGUAGES.some(([code]) => code === raw.language) ? raw.language! : DEFAULTS.language,
      };
    }
  } catch {
    prefs = DEFAULTS;
  }
  cache.set(botId, prefs);
  return prefs;
}

/** A bot's voice-chat speed and language: kept on this device for now, as nothing in a call reads them yet. */
export function setVoicePrefs(botId: string, patch: Partial<VoicePrefs>): void {
  const next = { ...read(botId), ...patch };
  cache.set(botId, next);
  try { globalThis.localStorage?.setItem(key(botId), JSON.stringify(next)); } catch { /* private mode keeps it in memory */ }
  for (const watch of Array.from(watchers)) watch();
}

export function useVoicePrefs(botId: string): VoicePrefs {
  return useSyncExternalStore(
    (watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; },
    () => read(botId),
    () => DEFAULTS,
  );
}
