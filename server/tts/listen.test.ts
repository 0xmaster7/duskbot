import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import { describeVoice } from "./index.ts";
import { describeListen, listener, transcribe } from "./listen.ts";

afterEach(() => vi.unstubAllGlobals());

describe("hearing speech on the server", () => {
  it("picks Fish first, then the dedicated speech keys, then OpenAI and Groq, AssemblyAI last", () => {
    expect(listener({})).toBeNull();
    expect(listener({ tts: { assemblyAiKey: "a" } })?.provider).toBe("assemblyai");
    expect(listener({ tts: { assemblyAiKey: "a", cartesiaKey: "c" } })?.provider).toBe("cartesia");
    expect(listener({ groq: { key: "g" }, tts: { cartesiaKey: "c" } })?.provider).toBe("groq");
    expect(listener({ groq: { key: "g" }, openai: { key: "o" } })?.provider).toBe("openai");
    expect(listener({ openai: { key: "o" }, tts: { key: "eleven" } })?.provider).toBe("elevenlabs");
    expect(listener({ tts: { key: "eleven", deepgramKey: "d" } })?.provider).toBe("deepgram");
    expect(listener({ tts: { deepgramKey: "d", fishKey: "f" } })).toEqual({ provider: "fish", key: "f" });
    expect(listener({ tts: { fishKey: "  " } })).toBeNull();
  });

  it("reports readiness by service name and never the key", () => {
    const cfg: AppConfig = { groq: { key: "gsk_secret" } };
    expect(describeListen(cfg)).toEqual({ ready: true, provider: "Groq" });
    expect(describeVoice(cfg).listen).toEqual({ ready: true, provider: "Groq" });
    expect(JSON.stringify(describeVoice(cfg))).not.toContain("gsk_secret");
    expect(describeVoice({}).listen).toEqual({ ready: false });
  });

  it("sends the clip to Groq Whisper through the shared request code", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: " hi " }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribe({ provider: "groq", key: "gsk_k" }, new Uint8Array([1]), "audio/wav")).toBe("hi");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.headers).toEqual({ authorization: "Bearer gsk_k" });
  });
});
