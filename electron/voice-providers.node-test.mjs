import test from "node:test";
import assert from "node:assert/strict";
import { VoiceProviderError, createPieceSession, encodeWav16, transcribeClip } from "./voice-providers.mjs";

const wav = encodeWav16(new Int16Array([1, -2, 3]));
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function fakeFetch(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = typeof answers === "function" ? answers(String(url), init, calls.length) : answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

test("encodeWav16 writes a 16 kHz mono 16-bit header around the samples", () => {
  const out = encodeWav16(new Int16Array([0, 32767, -32768]), 16_000);
  const view = new DataView(out.buffer);
  const tag = at => String.fromCharCode(...out.slice(at, at + 4));
  assert.equal(out.length, 44 + 6);
  assert.equal(tag(0), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + 6);
  assert.equal(tag(8), "WAVE");
  assert.equal(tag(12), "fmt ");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(28, true), 32_000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(tag(36), "data");
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)], [0, 32767, -32768]);
});

test("ElevenLabs: multipart to speech-to-text with xi-api-key, model_id and the language", async () => {
  const { fetch, calls } = fakeFetch([ok({ text: " hello there " })]);
  assert.equal(await transcribeClip({ provider: "elevenlabs", wav, key: "k1", language: "en-US", fetch }), "hello there");
  const [{ url, init }] = calls;
  assert.equal(url, "https://api.elevenlabs.io/v1/speech-to-text");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["xi-api-key"], "k1");
  assert.equal(init.body.get("model_id"), "scribe_v3");
  assert.equal(init.body.get("language_code"), "en");
  assert.equal(init.body.get("file").type, "audio/wav");
  assert.equal(init.body.get("file").size, wav.length);
});

test("OpenAI and Groq: Bearer key, model and ISO language to audio/transcriptions", async () => {
  for (const [provider, endpoint, model] of [
    ["openai", "https://api.openai.com/v1/audio/transcriptions", "gpt-transcribe"],
    ["groq", "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3-turbo"],
  ]) {
    const { fetch, calls } = fakeFetch([ok({ text: "hi" })]);
    assert.equal(await transcribeClip({ provider, wav, key: "k2", language: "pt-BR", fetch }), "hi");
    const [{ url, init }] = calls;
    assert.equal(url, endpoint);
    assert.equal(init.headers.authorization, "Bearer k2");
    assert.equal(init.body.get("model"), model);
    assert.equal(init.body.get("language"), "pt");
    assert.equal(init.body.get("file").name, "audio.wav");
  }
  const { fetch, calls } = fakeFetch([ok({ text: "x" })]);
  await transcribeClip({ provider: "openai", wav, key: "k", model: "whisper-1", fetch });
  assert.equal(calls[0].init.body.get("model"), "whisper-1");
  assert.equal(calls[0].init.body.has("language"), false);
});

test("OpenAI-compatible: the base address, key optional, https only (http only to this computer)", async () => {
  const { fetch, calls } = fakeFetch(() => ok({ text: "local words" }));
  assert.equal(await transcribeClip({ provider: "openai-compatible", wav, baseUrl: "http://127.0.0.1:8000/v1/", fetch }), "local words");
  assert.equal(calls[0].url, "http://127.0.0.1:8000/v1/audio/transcriptions");
  assert.equal(calls[0].init.headers.authorization, undefined);
  await transcribeClip({ provider: "openai-compatible", wav, key: "c", baseUrl: "https://stt.example.com/v1", fetch });
  assert.equal(calls[1].url, "https://stt.example.com/v1/audio/transcriptions");
  assert.equal(calls[1].init.headers.authorization, "Bearer c");
  for (const baseUrl of [undefined, "http://stt.example.com/v1", "ftp://x", "https://user:pw@x.com"]) {
    await assert.rejects(transcribeClip({ provider: "openai-compatible", wav, baseUrl, fetch }), { reason: "not-set-up" });
  }
  assert.equal(calls.length, 2);
});

test("Deepgram: raw WAV to listen with Token auth, the model and language or detection", async () => {
  const { fetch, calls } = fakeFetch(() => ok({ results: { channels: [{ alternatives: [{ transcript: "deep words" }] }] } }));
  assert.equal(await transcribeClip({ provider: "deepgram", wav, key: "dg", language: "en-GB", fetch }), "deep words");
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://api.deepgram.com/v1/listen");
  assert.equal(url.searchParams.get("model"), "nova-3");
  assert.equal(url.searchParams.get("language"), "en-GB");
  assert.equal(calls[0].init.headers.authorization, "Token dg");
  assert.equal(calls[0].init.headers["content-type"], "audio/wav");
  assert.equal(calls[0].init.body, wav);
  await transcribeClip({ provider: "deepgram", wav, key: "dg", fetch });
  assert.equal(new URL(calls[1].url).searchParams.get("detect_language"), "true");
});

test("AssemblyAI: upload, create, poll until completed", async () => {
  let polls = 0;
  const { fetch, calls } = fakeFetch((url) => {
    if (url.endsWith("/v2/upload")) return ok({ upload_url: "https://cdn.assemblyai.com/upload/abc" });
    if (url.endsWith("/v2/transcript")) return ok({ id: "t-1", status: "queued" });
    polls += 1;
    return ok(polls < 2 ? { id: "t-1", status: "processing" } : { id: "t-1", status: "completed", text: "assembled" });
  });
  assert.equal(await transcribeClip({ provider: "assemblyai", wav, key: "aa", language: "de", fetch }), "assembled");
  assert.equal(calls[0].init.headers.authorization, "aa");
  assert.equal(calls[0].init.body, wav);
  const created = JSON.parse(calls[1].init.body);
  assert.equal(created.audio_url, "https://cdn.assemblyai.com/upload/abc");
  assert.equal(created.language_code, "de");
  assert.deepEqual(created.speech_models, ["universal-3-5-pro", "universal-2"]);
  assert.equal(calls[2].url, "https://api.assemblyai.com/v2/transcript/t-1");
  assert.equal(calls.length, 4);
});

test("AssemblyAI: an error status is a service failure", async () => {
  const { fetch } = fakeFetch((url) => {
    if (url.endsWith("/upload")) return ok({ upload_url: "u" });
    if (url.endsWith("/transcript")) return ok({ id: "t2" });
    return ok({ status: "error", error: "audio too short" });
  });
  await assert.rejects(transcribeClip({ provider: "assemblyai", wav, key: "aa", fetch }), (error) => error.reason === "service" && /audio too short/.test(error.message));
});

test("failures map to bad-key, rate-limited, network and service; the key never shows in a message", async () => {
  const cases = [
    [new Response("{}", { status: 401 }), "bad-key"],
    [new Response("{}", { status: 403 }), "bad-key"],
    [new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429 }), "rate-limited"],
    [new Response("oops", { status: 500 }), "service"],
    [new TypeError("fetch failed"), "network"],
  ];
  for (const [answer, reason] of cases) {
    const { fetch } = fakeFetch([answer]);
    await assert.rejects(transcribeClip({ provider: "openai", wav, key: "secret-key-123", fetch }), (error) => {
      assert.ok(error instanceof VoiceProviderError);
      assert.equal(error.reason, reason);
      assert.doesNotMatch(error.message, /secret-key-123/);
      return true;
    });
  }
  await assert.rejects(transcribeClip({ provider: "openai", wav, fetch: fakeFetch([]).fetch }), { reason: "not-set-up" });
  await assert.rejects(transcribeClip({ provider: "whisper-cpp", wav }), { reason: "not-set-up" });
});

test("an abort stays an abort, not a network failure", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = async (_url, init) => { init.signal.throwIfAborted(); };
  await assert.rejects(transcribeClip({ provider: "groq", wav, key: "g", fetch, signal: controller.signal }), { name: "AbortError" });
});

// 16 kHz: 512 samples per 32 ms frame
const loud = ms => new Int16Array(Math.round(ms * 16)).fill(8_000);
const quiet = ms => new Int16Array(Math.round(ms * 16));
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve)); };

function pieces({ concurrency } = {}) {
  const sent = [], texts = [], errors = [];
  const waiting = [];
  const session = createPieceSession({
    transcribe: (piece, signal) => new Promise((resolve, reject) => {
      sent.push({ piece, signal });
      waiting.push({ resolve, reject, signal });
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
    onText: (text, partial) => texts.push([text, partial]),
    onError: error => errors.push(error),
    concurrency,
  });
  return { session, sent, texts, errors, waiting };
}

test("a pause after speech sends a piece with a short lead-in; silence alone sends nothing", async () => {
  const h = pieces();
  h.session.push(quiet(1_000));
  assert.equal(h.sent.length, 0);
  h.session.push(loud(500));
  h.session.push(quiet(400));
  assert.equal(h.sent.length, 0, "a short breath does not end the piece");
  h.session.push(quiet(400));
  assert.equal(h.sent.length, 1);
  const samples = (h.sent[0].piece.length - 44) / 2;
  // lead-in (up to ~400 ms) + speech (500 ms) + tail (~250 ms), never the whole second of silence before
  assert.ok(samples > 500 * 16 && samples < 1_250 * 16, `piece is ${samples / 16} ms`);
  h.session.push(quiet(3_000));
  assert.equal(h.sent.length, 1);
  h.session.stop();
});

test("long unbroken speech is cut at the cap", () => {
  const h = pieces();
  h.session.push(loud(26_000));
  assert.equal(h.sent.length, 1);
  const samples = (h.sent[0].piece.length - 44) / 2;
  assert.ok(samples >= 24_000 * 16 && samples <= 25_500 * 16);
  h.session.stop();
});

test("pieces return out of order but the words are reported in order, and the final comes once", async () => {
  const h = pieces();
  for (let i = 0; i < 3; i += 1) {
    h.session.push(loud(400));
    h.session.push(quiet(800));
  }
  assert.equal(h.sent.length, 3);
  h.waiting[1].resolve("two");
  await settle();
  assert.deepEqual(h.texts, [], "nothing until the first piece is back");
  h.waiting[0].resolve("one");
  await settle();
  assert.deepEqual(h.texts, [["one two", true]]);
  h.session.push(loud(300));
  const finished = h.session.finish();
  await settle();
  assert.equal(h.sent.length, 4, "finish sends the tail at once");
  h.waiting[2].resolve("three");
  h.waiting[3].resolve("four");
  await finished;
  assert.deepEqual(h.texts, [["one two", true], ["one two three", true], ["one two three four", true], ["one two three four", false]]);
  assert.equal(h.texts.filter(([, partial]) => !partial).length, 1);
  await h.session.finish();
  assert.equal(h.texts.length, 4);
});

test("finish with nothing heard still answers once, with no words", async () => {
  const h = pieces();
  h.session.push(quiet(500));
  await h.session.finish();
  assert.deepEqual(h.texts, [["", false]]);
  assert.equal(h.sent.length, 0);
});

test("stop aborts pieces on their way and says nothing more", async () => {
  const h = pieces();
  h.session.push(loud(400));
  h.session.push(quiet(800));
  h.session.push(loud(400));
  const finished = h.session.finish();
  h.session.stop();
  await finished;
  assert.ok(h.sent.every(({ signal }) => signal.aborted));
  await settle();
  assert.deepEqual(h.texts, []);
  assert.deepEqual(h.errors, []);
});

test("a failed piece reports one error, aborts the rest, and no final follows", async () => {
  const h = pieces();
  h.session.push(loud(400));
  h.session.push(quiet(800));
  h.session.push(loud(400));
  h.session.push(quiet(800));
  h.waiting[0].reject(new VoiceProviderError("bad-key", "no"));
  await settle();
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].reason, "bad-key");
  assert.ok(h.sent[1].signal.aborted);
  await h.session.finish();
  assert.deepEqual(h.texts, []);
});

test("concurrency holds later pieces until one returns", async () => {
  const h = pieces({ concurrency: 1 });
  h.session.push(loud(400));
  h.session.push(quiet(800));
  h.session.push(loud(400));
  h.session.push(quiet(800));
  await settle();
  assert.equal(h.sent.length, 1);
  h.waiting[0].resolve("a");
  await settle();
  assert.equal(h.sent.length, 2);
  h.session.stop();
});
