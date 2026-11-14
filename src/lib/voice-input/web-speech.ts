// A browser tab's own recognizer (the Web Speech API), for the web app. Chrome ends a continuous session on its own
// after a quiet spell, so an unasked end starts it again and keeps what was already heard.
import { createVoiceEvents, levelOf, type VoiceBridge, type VoiceEnd } from "./bridge";
import { webRecognition, type SpeechRecognitionLike } from "./device";
import { openMic, type MicCapture } from "./mic-capture";

const join = (left: string, right: string) => (left && right ? `${left} ${right}` : left || right);

export function createWebSpeech(): VoiceBridge {
  const events = createVoiceEvents();
  let recognition: SpeechRecognitionLike | null = null;
  let mic: MicCapture | null = null;
  let generation = 0;
  let committed = "";
  let latest = "";
  let finishing = false;

  const teardown = () => {
    generation += 1;
    const current = recognition;
    recognition = null;
    if (current) {
      current.onresult = current.onerror = current.onend = null;
      try { current.abort(); } catch {}
    }
    mic?.close();
    mic = null;
  };

  const ended = (info: VoiceEnd) => {
    teardown();
    events.end(info);
  };

  const listen = (gen: number, locale: string | undefined) => {
    const Recognition = webRecognition();
    if (!Recognition) return ended({ code: 2, reason: "unsupported-platform" });
    const next = new Recognition();
    next.lang = locale || navigator.language || "en-US";
    next.continuous = true;
    next.interimResults = true;
    let heard = "";
    next.onresult = (event) => {
      if (gen !== generation) return;
      heard = "";
      for (let i = 0; i < event.results.length; i += 1) heard = join(heard, event.results[i]![0]!.transcript.trim());
      latest = join(committed, heard);
      events.transcript({ partial: true, text: latest });
    };
    next.onerror = (event) => {
      if (gen !== generation || event.error === "no-speech" || event.error === "aborted") return;
      ended({ code: 1, reason: event.error === "not-allowed" || event.error === "service-not-allowed" ? "microphone-blocked"
        : event.error === "audio-capture" ? "microphone-missing" : "recognition-error" });
    };
    next.onend = () => {
      if (gen !== generation) return;
      committed = latest;
      if (finishing) {
        if (latest) events.transcript({ partial: false, text: latest });
        return ended({ code: 0, reason: "completed" });
      }
      listen(gen, locale);
    };
    recognition = next;
    try {
      next.start();
    } catch {
      ended({ code: 1, reason: "recognition-error" });
    }
  };

  return {
    async speechStart(options) {
      teardown();
      const gen = generation;
      committed = latest = "";
      finishing = false;
      listen(gen, options?.locale);
      // the waveform only: the recognizer listens on its own, and a refused meter must not stop the words
      void openMic((frame) => events.level(levelOf(frame))).then((opened) => {
        if (gen === generation) mic = opened;
        else opened.close();
      }, () => {});
    },
    async speechStop() {
      teardown();
    },
    async speechFinish() {
      if (!recognition) return;
      finishing = true;
      mic?.close();
      mic = null;
      try { recognition.stop(); } catch { ended({ code: 0, reason: "completed" }); }
    },
    onSpeechTranscript: events.onSpeechTranscript,
    onSpeechEnd: events.onSpeechEnd,
    onSpeechLevel: events.onSpeechLevel,
  };
}
