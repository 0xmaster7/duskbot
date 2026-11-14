import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import { describeVoice, listVoices, providerConfigured, speak, voiceReady } from "./index.ts";

afterEach(() => vi.unstubAllGlobals());

const config: AppConfig = { openai: { key: "sk-proj-fixture" }, tts: { provider: "openai", voice: "marin" } };
const audioReply = (status = 200, type = "audio/mpeg", body: ConstructorParameters<typeof Response>[0] = new Uint8Array([0xff, 0xfb, 1])) =>
  vi.fn(async () => new Response(body, { status, headers: { "content-type": type } }));

describe("OpenAI voice", () => {
  it("speaks with the OpenAI key under API keys and a built-in voice", async () => {
    const fetchMock = audioReply();
    vi.stubGlobal("fetch", fetchMock);
    const audio = await speak(config, "Hello there", "cedar");
    expect(audio.mime).toBe("audio/mpeg");
    expect(audio.bytes.byteLength).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-proj-fixture");
    expect(JSON.parse(String(init.body))).toEqual({ model: "gpt-4o-mini-tts", input: "Hello there", voice: "cedar", response_format: "mp3" });
  });

  it("needs the OpenAI key and a known voice", async () => {
    const noKey: AppConfig = { tts: { provider: "openai", voice: "marin" } };
    expect(providerConfigured(noKey)).toBe(false);
    expect(() => speak(noKey, "hi")).toThrow("Add an OpenAI key");
    expect(voiceReady(config)).toBe(true);
    expect(voiceReady(config, "not-a-voice")).toBe(false);
    expect((await listVoices(config)).map((voice) => voice.id)).toContain("marin");
    expect(await listVoices(noKey)).toEqual([]);
    expect(JSON.stringify(describeVoice(config))).not.toContain("sk-proj-fixture");
  });

  it.each([401, 429, 500])("maps HTTP %i without echoing the body", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "sk-proj-fixture leaked" } }), { status })));
    const promise = speak(config, "hi");
    await expect(promise).rejects.toThrow(/OpenAI/);
    await expect(promise).rejects.not.toThrow(/leaked/);
  });

  it("refuses JSON posing as audio", async () => {
    vi.stubGlobal("fetch", audioReply(200, "application/json", "{}"));
    await expect(speak(config, "hi")).rejects.toThrow("unexpected audio format");
  });
});
