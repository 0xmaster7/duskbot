import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import { transcribe, verifyKey } from "./cartesia.ts";
import { listVoices, speak, voiceReady } from "./index.ts";

afterEach(() => vi.unstubAllGlobals());

const VOICE = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";
const config: AppConfig = { tts: { provider: "cartesia", cartesiaKey: "sk_car_fixture", voice: VOICE } };
const call = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls[0] as unknown as [string, RequestInit];

describe("Cartesia voice", () => {
  it("speaks Sonic MP3 with the version header and the voice id", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await speak(config, "Hello")).bytes.byteLength).toBe(1);
    const [url, init] = call(fetchMock);
    expect(url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(init.headers).toMatchObject({ authorization: "Bearer sk_car_fixture", "cartesia-version": "2026-08-14" });
    expect(JSON.parse(String(init.body))).toEqual({
      model_id: "sonic-3.6", transcript: "Hello", voice: { id: VOICE }, output_format: { container: "mp3", sample_rate: 44_100, bit_rate: 64_000 },
    });
  });

  it("searches the voice library and keeps only real voice ids", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: VOICE, name: "Katie", description: "Friendly" }, { id: "../x", name: "Bad" },
    ], has_more: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listVoices(config, undefined, { query: "kat" })).toEqual([{ id: VOICE, label: "Katie", description: "Friendly" }]);
    expect(call(fetchMock)[0]).toBe("https://api.cartesia.ai/voices?limit=100&q=kat");
    expect(voiceReady(config, "../x")).toBe(false);
  });

  it("maps a rejected key without echoing the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("sk_car_fixture", { status: 401 })));
    const promise = speak(config, "hi");
    await expect(promise).rejects.toThrow("Cartesia rejected the key");
    await expect(promise).rejects.not.toThrow(/fixture/);
  });

  it("hears a clip with Ink", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: "transcript", text: " hello bot " }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribe(new Uint8Array([1, 2]), "audio/wav", "sk_car_k")).toBe("hello bot");
    const [url, init] = call(fetchMock);
    expect(url).toBe("https://api.cartesia.ai/stt");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("ink-whisper");
    expect((form.get("file") as File).size).toBe(2);
  });

  describe("key check", () => {
    it("accepts a good key", async () => {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      expect(await verifyKey("sk_car_good")).toEqual({ ok: true });
      expect(call(fetchMock)[0]).toBe("https://api.cartesia.ai/voices?limit=1");
    });

    it("rejects a 401", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
      expect(await verifyKey("sk_car_bad")).toEqual({ ok: false, message: "Cartesia rejected that key." });
    });
  });
});
