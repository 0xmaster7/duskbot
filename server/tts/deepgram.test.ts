import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import { verifyKey } from "./deepgram.ts";
import { listVoices, speak, voiceReady } from "./index.ts";

afterEach(() => vi.unstubAllGlobals());

const config: AppConfig = { tts: { provider: "deepgram", deepgramKey: "dg-fixture", voice: "aura-2-thalia-en" } };

describe("Deepgram voice", () => {
  it("speaks through Aura with a Token header and the voice as the model", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const audio = await speak(config, "Hi", "aura-2-draco-en");
    expect(audio.bytes.byteLength).toBe(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepgram.com/v1/speak?model=aura-2-draco-en");
    expect((init.headers as Record<string, string>).authorization).toBe("Token dg-fixture");
    expect(JSON.parse(String(init.body))).toEqual({ text: "Hi" });
  });

  it("lists Aura-2 voices and refuses anything else as a voice", async () => {
    expect((await listVoices(config))[0]).toEqual({ id: "aura-2-thalia-en", label: "Thalia", description: "Feminine" });
    expect(voiceReady(config, "../speak")).toBe(false);
  });

  it("maps a rejected key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(speak(config, "hi")).rejects.toThrow("Deepgram rejected the key");
  });

  describe("key check", () => {
    it("accepts a good key", async () => {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      expect(await verifyKey("dg-good")).toEqual({ ok: true });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.deepgram.com/v1/auth/token");
      expect(init.headers).toEqual({ authorization: "Token dg-good" });
    });

    it("rejects a 401, but not a 403 from a key whose role cannot read its own details", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
      expect(await verifyKey("dg-bad")).toEqual({ ok: false, message: "Deepgram rejected that key." });
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
      expect(await verifyKey("dg-member")).toEqual({ ok: true });
    });

    it("says Deepgram was unreachable", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
      expect(await verifyKey("dg")).toEqual({ ok: false, message: "Couldn't reach Deepgram to check that key: check your connection." });
    });
  });
});
