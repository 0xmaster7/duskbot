// Settings > Voice's test: listen through the chosen engine for a few seconds, then hand back what it heard. Never
// leaves a session running: every way out stops the bridge and drops its listeners.
import type { VoiceBridge, VoiceEnd, VoiceStartOptions } from "./bridge";

export const LISTEN_ONCE_MS = 3_000;
/** How long the engine may take to deliver its last words after capture ends. */
export const LISTEN_ONCE_GRACE_MS = 10_000;

export type ListenOnceResult = { ok: true; text: string } | { ok: false; end: VoiceEnd };

export interface ListenOnceOptions extends Pick<VoiceStartOptions, "locale"> {
  ms?: number;
  graceMs?: number;
  signal?: AbortSignal;
}

const failure = (reason: string, message?: string): ListenOnceResult => ({ ok: false, end: { code: 1, reason, ...(message ? { message } : {}) } });

export function listenOnce(bridge: VoiceBridge, options: ListenOnceOptions = {}): Promise<ListenOnceResult> {
  const { ms = LISTEN_ONCE_MS, graceMs = LISTEN_ONCE_GRACE_MS, locale, signal } = options;
  return new Promise<ListenOnceResult>((resolve) => {
    let latest = "";
    let settled = false;
    let ended = false;
    let finishing = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const offs: Array<() => void> = [];

    const done = (result: ListenOnceResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(finishTimer);
      clearTimeout(graceTimer);
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

    bridge.speechStart(locale ? { locale } : undefined).then(() => {
      if (settled) return;
      finishTimer = setTimeout(() => {
        if (settled) return;
        finishing = true;
        graceTimer = setTimeout(() => done(latest.trim() ? heard() : failure("transcribe-timeout")), graceMs);
        // an engine with no way to finish has nothing more to give once it stops
        const finish = bridge.speechFinish ? bridge.speechFinish() : bridge.speechStop().then(() => { ended = true; done(heard()); });
        void finish.catch((error: unknown) => done(failure("recognition-error", error instanceof Error ? error.message : undefined)));
      }, ms);
    }, (error: unknown) => done(failure("recognition-error", error instanceof Error ? error.message : undefined)));
  });
}
