import { beforeEach, describe, expect, it, vi } from "vitest";

// the real seal and open round trip is in server/sealed-fields.test.ts: here, what leaves the app and when it seals again
const fx = vi.hoisted(() => ({ api: vi.fn(), sealed: new Map<string, { values: Record<string, string>; keyId: string; purpose: string; target: readonly string[] }>() }));
vi.mock("@/state/api", async (original) => ({ ...await original<typeof import("@/state/api")>(), api: fx.api }));
vi.mock("@/lib/card-seal", async (original) => ({
  ...await original<typeof import("@/lib/card-seal")>(),
  sealValues: async (values: Record<string, string>, key: { keyId: string }, purpose: string, target: readonly string[]) => {
    const ciphertext = `c${fx.sealed.size}`;
    fx.sealed.set(ciphertext, { values, keyId: key.keyId, purpose, target });
    return { keyId: key.keyId, encapsulatedKey: "E", ciphertext };
  },
}));

const { putConfig, sendSealed } = await import("./sealed-send");
const { ApiError } = await import("@/state/api");

const KEY = "sk-fake-client-key-5678";
const sealKey = (keyId: string) => ({ version: 1, keyId, x: "x", y: "y", identity: "i", signature: "s" });

beforeEach(() => { fx.api.mockReset(); fx.sealed.clear(); });

describe("an API key saved through a relay", () => {
  it("leaves the app sealed for the settings it names, and the rest of the patch as it is", async () => {
    fx.api.mockImplementation(async (path: string) => (path === "/api/seal-key" ? { sealKey: sealKey("k1") } : { ok: true }));
    await putConfig({ anthropic: { key: KEY, everyClaudeBot: false } });
    await putConfig({ opencodeGo: { providerKeys: { GROQ_API_KEY: KEY } }, tts: { key: KEY } });
    const sent = fx.api.mock.calls.filter(([path]) => path === "/api/config").map(([, init]) => JSON.parse(init.body as string));
    for (const body of sent) expect(JSON.stringify(body)).not.toContain(KEY);
    expect(sent[0]).toEqual({ anthropic: { everyClaudeBot: false }, sealed: { keyId: "k1", encapsulatedKey: "E", ciphertext: "c0" }, sealedPaths: ["anthropic.key"] });
    expect(sent[1].sealedPaths).toEqual(["opencodeGo.providerKeys.GROQ_API_KEY", "tts.key"]);
    expect(fx.sealed.get("c1")).toEqual({ values: { "opencodeGo.providerKeys.GROQ_API_KEY": KEY, "tts.key": KEY }, keyId: "k1", purpose: "config", target: ["opencodeGo.providerKeys.GROQ_API_KEY", "tts.key"] });
  });

  it("sends a removal and a plain setting as they are", async () => {
    fx.api.mockResolvedValue({ ok: true });
    await putConfig({ openai: { key: "" } });
    expect(fx.api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ openai: { key: "" } }) });
  });

  it("seals once more for a server that restarted since its key was fetched, and never twice for the same key", async () => {
    const sends: string[] = [];
    const send = async (sealed: { keyId: string } | null) => {
      sends.push(sealed!.keyId);
      if (sealed!.keyId !== "k3") throw new ApiError("restarted", 409, { sealKey: sealKey("k3") });
      return "saved";
    };
    fx.api.mockResolvedValue({ sealKey: sealKey("k2") });
    expect(await sendSealed("login.update", ["l1"], { password: "fake-pass" }, send)).toBe("saved");
    expect(sends).toEqual([expect.not.stringMatching(/^k3$/u), "k3"]);
    sends.length = 0;
    const stuck = async (sealed: { keyId: string } | null) => { sends.push(sealed!.keyId); throw new ApiError("no", 409, { sealKey: sealKey(sealed!.keyId) }); };
    await expect(sendSealed("login.update", ["l1"], { password: "fake-pass" }, stuck)).rejects.toThrow("no");
    expect(sends).toHaveLength(1);
  });
});
