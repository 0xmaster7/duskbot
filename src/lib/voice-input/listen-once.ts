// Settings > Voice's test: listen through the chosen engine for a few seconds, then hand back what it heard. Never
// leaves a session running: every way out stops the bridge and drops its listeners.
import type { VoiceBridge, VoiceEnd, VoiceStartOptions } from "./bridge";

export const LISTEN_ONCE_MS = 3_000;
/** How long the engine may take to deliver its last words after capture ends. */
export const LISTEN_ONCE_GRACE_MS = 10_000;
/** The recognizer can take seconds to warm up (Windows starts PowerShell and loads a grammar): the listening window
 * starts at its first sign of life, or after this long if it never shows one. */
export const LISTEN_ONCE_WARMUP_MS = 8_000;

export type ListenOnceResult = { ok: true; text: string } | { ok: false; end: VoiceEnd };

export interface ListenOnceOptions extends Pick<VoiceStartOptions, "locale"> {
  ms?: number;
  graceMs?: number;
  warmupMs?: number;
  signal?: AbortSignal;
}

const failure = (reason: string, message?: string): ListenOnceResult => ({ ok: false, end: { code: 1, reason, ...(message ? { message } : {}) } });

export function listenOnce(bridge: VoiceBridge, options: ListenOnceOptions = {}): Promise<ListenOnceResult> {
  const { ms = LISTEN_ONCE_MS, graceMs = LISTEN_ONCE_GRACE_MS, warmupMs = LISTEN_ONCE_WARMUP_MS, locale, signal } = options;
  return new Promise<ListenOnceResult>((resolve) => {
    let latest = "";
    let settled = false;
    let ended = false;
    let finishing = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let warmTimer: ReturnType<typeof setTimeout> | undefined;
    const offs: Array<() => void> = [];

    const done = (result: ListenOnceResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(finishTimer);
      clearTimeout(graceTimer);
      clearTimeout(warmTimer);
      offs.splice(0).forEach((off) => off());
      signal?.removeEventListener("abort", onAbort);
      if (!ended) void bridge.speechStop().catch(() => {});
      resolve(result);
    };
    const heard = () => (latest.trim() ? { ok: true as const, text: latest.trim() } : failure("no-words"));
    function onAbort() {
      done(failure("aborted"));
    }

    offs.push(bridge.onSpeechTranscript((line) => {
      if (line.error) {
        done(failure("recognition-error", line.error));
        return;
      }
      if (typeof line.text === "string") latest = line.text;
      if (line.partial === false && finishing && latest.trim()) done(heard());
    }));
    offs.push(bridge.onSpeechEnd((info) => {
      ended = true;
      if (info.code && info.code !== 0) done({ ok: false, end: info });
      else done(heard());
    }));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);

    let started = false;
    let live = false;
    let sawLife = false;
    // the window opens when the recognizer is really listening, the same moment the composer's waveform starts moving
    const open = () => {
      if (live || settled || !started) return;
      live = true;
      clearTimeout(warmTimer);
      finishTimer = setTimeout(() => {
        if (settled) return;
        finishing = true;
        graceTimer = setTimeout(() => done(latest.trim() ? heard() : failure("transcribe-timeout")), graceMs);
        // an engine with no way to finish has nothing more to give once it stops
        const finish = bridge.speechFinish ? bridge.speechFinish() : bridge.speechStop().then(() => { ended = true; done(heard()); });
        void finish.catch((error: unknown) => done(failure("recognition-error", error instanceof Error ? error.message : undefined)));
      }, ms);
    };
    if (bridge.onSpeechLevel) offs.push(bridge.onSpeechLevel(() => { sawLife = true; open(); }));

    bridge.speechStart(locale ? { locale } : undefined).then(() => {
      if (settled) return;
      started = true;
      if (!bridge.onSpeechLevel || sawLife) open();
      else warmTimer = setTimeout(open, warmupMs);
    }, (error: unknown) => done(failure("recognition-error", error instanceof Error ? error.message : undefined)));
  });
}
