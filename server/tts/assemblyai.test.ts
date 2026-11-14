import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyKey } from "./assemblyai.ts";

afterEach(() => vi.unstubAllGlobals());

describe("AssemblyAI key check", () => {
  it("accepts a good key with a cheap authenticated read", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyKey("aai-good")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.assemblyai.com/v2/transcript?limit=1");
    expect(init.headers).toEqual({ authorization: "aai-good" });
  });

  it("rejects a 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect(await verifyKey("aai-bad")).toEqual({ ok: false, message: "AssemblyAI rejected that key." });
  });

  it("says AssemblyAI was unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await verifyKey("aai")).toEqual({ ok: false, message: "Couldn't reach AssemblyAI to check that key: check your connection." });
  });
});
