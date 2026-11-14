// The optional tidy-up after the words land: a quick model on the person's own AI connection fixes punctuation, filler
// words and formatting and keeps the meaning. Off by default; any failure keeps the words exactly as heard.
import { api } from "@/state/api";
import type { VoicePrefs } from "./prefs";

export const CLEANUP_TIMEOUT_MS = 12_000;
/** Too short to be worth a model call: "yes", "ok thanks". */
const CLEANUP_MIN_CHARS = 12;

export type CleanupRequest = (body: { text: string; instanceId?: string; model?: string }, signal?: AbortSignal) => Promise<{ text?: string }>;

const viaServer: CleanupRequest = (body, signal) =>
  api<{ text?: string }>("/api/voice/clean", { method: "POST", body: JSON.stringify(body), signal, timeoutMs: CLEANUP_TIMEOUT_MS });

export function cleanupWanted(prefs: Pick<VoicePrefs, "cleanup">, text: string): boolean {
  return prefs.cleanup.on && text.trim().length >= CLEANUP_MIN_CHARS;
}

/** The tidied words, or the heard words unchanged when clean-up is off, fails, or answers with nothing usable. */
export async function cleanTranscript(text: string, prefs: Pick<VoicePrefs, "cleanup">, request: CleanupRequest = viaServer, signal?: AbortSignal): Promise<string> {
  if (!cleanupWanted(prefs, text)) return text;
  try {
    const { instanceId, model } = prefs.cleanup;
    const answer = await request({ text, ...(instanceId ? { instanceId } : {}), ...(model ? { model } : {}) }, signal);
    const cleaned = typeof answer?.text === "string" ? answer.text.trim() : "";
    // a model that answered a question instead of tidying it, or dropped most of it, is not used
    if (!cleaned || cleaned.length > text.length * 1.6 + 40 || cleaned.length < text.trim().length * 0.4) return text;
    return cleaned;
  } catch {
    return text;
  }
}
