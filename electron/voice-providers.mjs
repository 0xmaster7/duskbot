// Speech-to-text requests to the services in voice-catalog.mjs, and the piece session that feeds them while the person
// talks. Pure (global fetch, FormData and Blob only, no Node builtins): the desktop app's main process and the phone's
// web view both import it.
import { VOICE_PROVIDER_INFO, voiceProviderModel } from "./voice-catalog.mjs";

export class VoiceProviderError extends Error {
  constructor(reason, message, status) {
    super(message);
    this.name = "VoiceProviderError";
    this.reason = reason;
    if (status !== undefined) this.status = status;
  }
}

const SAMPLE_RATE = 16_000;
const ASSEMBLY_POLL_MS = 600;
const ASSEMBLY_MAX_MS = 90_000;
const MESSAGE_MAX = 300;

const isAbort = (error) => error?.name === "AbortError" || error?.name === "TimeoutError";

/** The language part of a BCP 47 tag ("pt-BR" -> "pt"), for services that take ISO 639 codes. */
const languageOf = (tag) => {
  const primary = typeof tag === "string" ? tag.trim().split(/[-_]/)[0].toLowerCase() : "";
  return /^[a-z]{2,3}$/.test(primary) ? primary : "";
};

/** One fetch with the shared failure mapping; returns the Response only when it is ok. */
async function send(doFetch, url, init, service) {
  let response;
  try {
    response = await doFetch(url, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new VoiceProviderError("network", `Could not reach ${service}.`);
  }
  if (response.ok) return response;
  const detail = await response.text().then((text) => serviceMessage(text), () => "");
  const status = response.status;
  if (status === 401 || status === 403) throw new VoiceProviderError("bad-key", `${service} did not accept the key.${detail ? ` ${detail}` : ""}`, status);
  if (status === 429) throw new VoiceProviderError("rate-limited", `${service} is busy or out of credit right now.${detail ? ` ${detail}` : ""}`, status);
  throw new VoiceProviderError("service", `${service} answered ${status}.${detail ? ` ${detail}` : ""}`, status);
}

/** A short readable reason from an error body, never the whole body. */
function serviceMessage(text) {
  let message = text;
  try {
    const body = JSON.parse(text);
    const found = body?.error?.message ?? body?.detail?.message ?? body?.detail ?? body?.error ?? body?.message ?? body?.err_msg;
    message = typeof found === "string" ? found : "";
  } catch {
  }
  message = String(message ?? "").replace(/\s+/g, " ").trim();
  return message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX)}…` : message;
}

async function json(response, service) {
  try {
    return await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new VoiceProviderError("service", `${service} sent an answer that could not be read.`);
  }
}

const wavBlob = (wav) => new Blob([wav], { type: "audio/wav" });

function openAiStyle(url, { wav, key, model, language }) {
  const form = new FormData();
  form.append("file", wavBlob(wav), "audio.wav");
  form.append("model", model);
  form.append("response_format", "json");
  const lang = languageOf(language);
  if (lang) form.append("language", lang);
  return { url, init: { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body: form } };
}

/** The service's base address with no trailing slash; only https, or http to this computer. */
function compatBase(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl ?? "").trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password) return null;
  return url.href.replace(/\/+$/, "");
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? abortError());
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal.reason ?? abortError());
  };
  signal?.addEventListener("abort", onAbort, { once: true });
});

function abortError() {
  const error = new Error("The request was stopped.");
  error.name = "AbortError";
  return error;
}

async function assemblyAi({ wav, key, model, language, signal }, doFetch) {
  const service = "AssemblyAI";
  const base = "https://api.assemblyai.com/v2";
  const upload = await send(doFetch, `${base}/upload`, {
    method: "POST", headers: { authorization: key, "content-type": "application/octet-stream" }, body: wav, signal,
  }, service);
  const { upload_url: audioUrl } = await json(upload, service);
  if (typeof audioUrl !== "string") throw new VoiceProviderError("service", `${service} did not take the recording.`);
  const lang = languageOf(language);
  const created = await send(doFetch, `${base}/transcript`, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    // universal-2 hears the languages the newer model does not
    body: JSON.stringify({ audio_url: audioUrl, speech_models: model === "universal-2" ? [model] : [model, "universal-2"], ...(lang ? { language_code: lang } : { language_detection: true }), punctuate: true, format_text: true }),
    signal,
  }, service);
  const { id } = await json(created, service);
  if (typeof id !== "string" || !/^[\w-]+$/.test(id)) throw new VoiceProviderError("service", `${service} did not start the transcript.`);
  const started = Date.now();
  for (;;) {
    const polled = await send(doFetch, `${base}/transcript/${id}`, { method: "GET", headers: { authorization: key }, signal }, service);
    const body = await json(polled, service);
    if (body?.status === "completed") return typeof body.text === "string" ? body.text : "";
    if (body?.status === "error") throw new VoiceProviderError("service", `${service} could not hear it. ${serviceMessage(JSON.stringify({ message: body.error ?? "" }))}`.trim());
    if (Date.now() - started > ASSEMBLY_MAX_MS) throw new VoiceProviderError("service", `${service} took too long.`);
    await sleep(ASSEMBLY_POLL_MS, signal);
  }
}

/** One clip's words through one service's batch endpoint. Not whisper.cpp, which runs a program (voice-input-main.mjs). */
export async function transcribeClip(request) {
  const { provider, wav, signal } = request ?? {};
  const info = VOICE_PROVIDER_INFO[provider];
  if (!info || provider === "whisper-cpp") throw new VoiceProviderError("not-set-up", "This speech service is not available here.");
  if (!(wav instanceof Uint8Array)) throw new TypeError("wav must be a Uint8Array");
  const key = typeof request.key === "string" ? request.key.trim() : "";
  if (info.key === "required" && !key) throw new VoiceProviderError("not-set-up", `Add your ${info.name} key in Settings > Voice first.`);
  const doFetch = request.fetch ?? globalThis.fetch;
  const model = voiceProviderModel(provider, request.model);
  const service = info.name;
  const parts = { wav, key, model, language: request.language, signal };

  if (provider === "assemblyai") return (await assemblyAi(parts, doFetch)).trim();

  let url, init;
  if (provider === "openai") ({ url, init } = openAiStyle("https://api.openai.com/v1/audio/transcriptions", parts));
  else if (provider === "groq") ({ url, init } = openAiStyle("https://api.groq.com/openai/v1/audio/transcriptions", parts));
  else if (provider === "openai-compatible") {
    const base = compatBase(request.baseUrl);
    if (!base) throw new VoiceProviderError("not-set-up", "Add the service's address (https) in Settings > Voice first.");
    ({ url, init } = openAiStyle(`${base}/audio/transcriptions`, parts));
  } else if (provider === "elevenlabs") {
    const form = new FormData();
    form.append("file", wavBlob(wav), "audio.wav");
    form.append("model_id", model);
    form.append("tag_audio_events", "false");
    const lang = languageOf(request.language);
    if (lang) form.append("language_code", lang);
    url = "https://api.elevenlabs.io/v1/speech-to-text";
    init = { method: "POST", headers: { "xi-api-key": key }, body: form };
  } else if (provider === "deepgram") {
    const query = new URLSearchParams({ model, smart_format: "true", punctuate: "true" });
    const tag = typeof request.language === "string" ? request.language.trim() : "";
    if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(tag)) query.set("language", tag);
    else query.set("detect_language", "true");
    url = `https://api.deepgram.com/v1/listen?${query}`;
    init = { method: "POST", headers: { authorization: `Token ${key}`, "content-type": "audio/wav" }, body: wav };
  } else {
    throw new VoiceProviderError("not-set-up", "This speech service is not available here.");
  }

  const response = await send(doFetch, url, { ...init, signal }, service);
  const body = await json(response, service);
  const text = provider === "deepgram" ? body?.results?.channels?.[0]?.alternatives?.[0]?.transcript : body?.text;
  return typeof text === "string" ? text.trim() : "";
}

/** A 16-bit mono PCM WAV file around the samples. */
export function encodeWav16(pcm, sampleRate = SAMPLE_RATE) {
  const bytes = pcm.length * 2;
  const out = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at, value) => { for (let i = 0; i < value.length; i += 1) out.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF");
  out.setUint32(4, 36 + bytes, true);
  text(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, sampleRate, true);
  out.setUint32(28, sampleRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, bytes, true);
  for (let i = 0; i < pcm.length; i += 1) out.setInt16(44 + i * 2, pcm[i], true);
  return new Uint8Array(out.buffer);
}

// the endpointer, in fixed frames so it behaves the same whatever size the audio arrives in
const FRAME_MS = 32;
const SPEECH_RMS = 0.015 * 32768;
const SPEECH_FRAMES = 3;
const LEAD_MS = 300;
const TAIL_MS = 250;
const PIECE_MAX_MS = 25_000;
// past this, a gap between words is enough to send the piece, so a long run of speech still shows as it goes
const PIECE_SOFT_MS = 8_000;
const WORD_GAP_MS = 160;
const PIECE_TIMEOUT_MS = 60_000;

function levelOf(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / (frame.length || 1));
}

function joinFrames(frames) {
  const out = new Int16Array(frames.reduce((n, frame) => n + frame.length, 0));
  let at = 0;
  for (const frame of frames) {
    out.set(frame, at);
    at += frame.length;
  }
  return out;
}

const joinText = (texts) => texts.map((text) => text.trim()).filter(Boolean).join(" ");

/** Batch services heard while the person talks: each pause ends a piece that is sent at once, and the words so far are
 * reported in order as pieces come back. */
export function createPieceSession({ transcribe, onText, onError, sampleRate = SAMPLE_RATE, pauseMs = 500, softPieceMs = PIECE_SOFT_MS, maxPieceMs = PIECE_MAX_MS, concurrency = 3, timeoutMs = PIECE_TIMEOUT_MS }) {
  const frameSamples = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const leadFrames = Math.ceil(LEAD_MS / FRAME_MS) + SPEECH_FRAMES;
  const tailFrames = Math.ceil(TAIL_MS / FRAME_MS);
  const softFrames = Math.ceil(softPieceMs / FRAME_MS);
  const maxFrames = Math.ceil(maxPieceMs / FRAME_MS);

  let carry = new Int16Array(0);
  let frames = [];
  let loud = 0, quietMs = 0, spoke = false, lastLoud = -1;

  const texts = [];
  const queue = [];
  const running = new Set();
  let reported = "";
  let closed = false, stopped = false, failed = false;
  let settle = null;

  const live = () => !stopped && !failed;

  const report = () => {
    if (!live()) return;
    let done = 0;
    while (done < texts.length && texts[done] !== null) done += 1;
    const text = joinText(texts.slice(0, done));
    if (text && text !== reported) {
      reported = text;
      onText(text, true);
    }
  };

  const fail = (error) => {
    if (!live()) return;
    failed = true;
    for (const job of running) job.abort.abort();
    queue.length = 0;
    onError(error);
    settle?.();
  };

  const pump = () => {
    while (live() && running.size < concurrency && queue.length) {
      const { index, wav } = queue.shift();
      const job = { abort: new AbortController() };
      running.add(job);
      const timer = setTimeout(() => job.abort.abort(new VoiceProviderError("network", "The speech service took too long.")), timeoutMs);
      let request;
      try {
        request = Promise.resolve(transcribe(wav, job.abort.signal));
      } catch (error) {
        request = Promise.reject(error);
      }
      request
        .then((text) => {
          if (!live()) return;
          texts[index] = typeof text === "string" ? text : "";
          report();
        }, (error) => {
          const reason = job.abort.signal.reason;
          fail(reason instanceof VoiceProviderError ? reason : error);
        })
        .finally(() => {
          clearTimeout(timer);
          running.delete(job);
          pump();
          if (closed && !running.size && !queue.length) settle?.();
        });
    }
  };

  const cut = (keep) => {
    if (!spoke) return;
    const piece = frames.slice(0, Math.min(frames.length, lastLoud + 1 + tailFrames));
    // the quiet after the piece stays as the next one's lead-in
    frames = keep ? frames.slice(-leadFrames) : [];
    loud = 0;
    quietMs = 0;
    spoke = false;
    lastLoud = -1;
    const index = texts.length;
    texts.push(null);
    queue.push({ index, wav: encodeWav16(joinFrames(piece), sampleRate) });
    pump();
  };

  const hear = (frame) => {
    const level = levelOf(frame);
    frames.push(frame);
    if (level > SPEECH_RMS) {
      loud += 1;
      quietMs = 0;
      lastLoud = frames.length - 1;
      if (loud >= SPEECH_FRAMES) spoke = true;
    } else {
      loud = 0;
      if (spoke) quietMs += FRAME_MS;
    }
    if (!spoke && frames.length > leadFrames) frames = frames.slice(-leadFrames);
    if (spoke && quietMs >= pauseMs) cut(true);
    // without a lead-in: the frames just before a word gap are speech already in this piece
    else if (spoke && frames.length >= softFrames && quietMs >= WORD_GAP_MS) cut(false);
    else if (spoke && frames.length >= maxFrames) {
      // one long run of speech: send what there is and keep listening without a lead-in, so nothing is heard twice
      lastLoud = frames.length - 1 - tailFrames;
      cut(false);
    }
  };

  return {
    push(pcm) {
      if (closed || !live() || !(pcm instanceof Int16Array) || !pcm.length) return;
      let samples = pcm;
      if (carry.length) {
        samples = new Int16Array(carry.length + pcm.length);
        samples.set(carry);
        samples.set(pcm, carry.length);
      }
      let at = 0;
      for (; at + frameSamples <= samples.length; at += frameSamples) hear(samples.slice(at, at + frameSamples));
      carry = samples.slice(at);
    },
    finish() {
      if (closed) return Promise.resolve();
      closed = true;
      if (!live()) return Promise.resolve();
      if (carry.length) {
        hear(carry);
        carry = new Int16Array(0);
      }
      // the last piece ends at the end of the audio, whatever the pause
      if (spoke) {
        lastLoud = frames.length - 1;
        cut(false);
      }
      return new Promise((resolve) => {
        settle = () => {
          settle = null;
          if (live()) onText(joinText(texts.map((text) => text ?? "")), false);
          resolve();
        };
        if (!live() || (!running.size && !queue.length)) settle();
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      closed = true;
      queue.length = 0;
      for (const job of running) job.abort.abort();
      settle?.();
    },
  };
}
