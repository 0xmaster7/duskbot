import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobilePairingPayload } from "../../../shared/mobile-link";
import type { MobilePlatform } from "../platform";
import { createConnectionStore } from "./connections";
import { PairError, parseTypedPairing, redeemPairing } from "./pair";

const credential = `omb_pair_${"a".repeat(43)}`;
const payload: MobilePairingPayload = { v: 1, transport: "https", origin: "https://workspace.test", credential };

function fakePlatform() {
  const preferences = new Map<string, string>();
  const secrets = new Map<string, string>();
  const storage = (values: Map<string, string>) => ({
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); },
    remove: async (key: string) => { values.delete(key); },
  });
  const platform: MobilePlatform = { kind: "ios", native: true, prefs: storage(preferences), secrets: storage(secrets), deviceName: () => "Test phone", haptic() {}, openExternal: async () => {}, appVersion: "test" };
  return { platform, preferences, secrets };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("typed pairing", () => {
  it("parses phone links and 12-character workspace codes without inventing credentials", () => {
    expect(parseTypedPairing(`openmausbot://pair?address=https%3A%2F%2Fworkspace.test&token=${credential}`)).toMatchObject(payload);
    expect(parseTypedPairing("workspace.test abcd1234efgh")).toEqual({ ...payload, credential: "", code: "ABCD1234EFGH" });
    expect(parseTypedPairing(" https://workspace.test:8443 ABCD1234EFGH ")?.origin).toBe("https://workspace.test:8443");
  });

  it.each(["workspace.test 123456", "http://workspace.test ABCD1234EFGH", "https://person:secret@workspace.test ABCD1234EFGH", "https://workspace.test/path ABCD1234EFGH", "https://workspace.test?query ABCD1234EFGH", "https://workspace.test#fragment ABCD1234EFGH", "https://workspace.test\\elsewhere ABCD1234EFGH", "openmausbot://pair?address=workspace.test", "unrelated text"])("rejects %s", (input) => {
    expect(parseTypedPairing(input)).toBeNull();
  });
});

describe("pairing exchange", () => {
  it.each([
    [400, {}, "invalid"], [400, { error: "pairing expired" }, "expired"], [410, {}, "expired"],
    [409, {}, "used"], [401, {}, "refused"], [403, {}, "refused"], [503, {}, "unreachable"],
  ])("maps HTTP %s to %s", async (status, body, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
    await expect(redeemPairing(payload, fakePlatform().platform)).rejects.toMatchObject({ name: "PairError", code, message: `mobile.pair.${code}` });
  });

  it("reuses the persisted attempt after a network drop and discovers capabilities", async () => {
    const { platform, preferences, secrets } = fakePlatform();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response({ token: "test-token", serverName: "Studio" }, 201))
      .mockResolvedValueOnce(response({ environmentId: "studio", scopes: ["admin"], id: "session-1" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(redeemPairing(payload, platform)).rejects.toMatchObject({ code: "unreachable" });
    const result = await redeemPairing(payload, platform);
    const first = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const retry = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(first.pairRequestId).toBe(retry.pairRequestId);
    expect(first).toMatchObject({ credential, deviceName: "Test phone" });
    expect([...preferences.keys()]).toEqual([expect.stringMatching(/^omb\.mobile\.pairAttempt\.[a-f0-9]{12}$/)]);
    expect([...preferences.values()]).not.toContain(credential);
    expect(result.record).toMatchObject({ label: "Studio", environmentId: "studio", sessionId: "session-1", capabilities: { computerControl: true, routines: true, notifications: true, settingsWrite: true, openOnDesktop: false } });
    expect(result.record.sessionRef).toBe(`token.${result.record.id}`);
    expect(secrets.size).toBe(0);
    expect(fetcher.mock.calls[2]).toEqual(["https://workspace.test/api/auth/session", expect.objectContaining({ headers: { Authorization: "Bearer test-token" }, credentials: "omit", redirect: "error" })]);
  });

  it("sends typed codes without credential and separates attempts for different codes", async () => {
    const { platform } = fakePlatform();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/api/pair") ? response({ token: "test" }) : response({}));
    vi.stubGlobal("fetch", fetcher);
    const typed = parseTypedPairing("workspace.test ABCD1234EFGH")!;
    await redeemPairing(typed, platform);
    await redeemPairing({ ...typed, code: "ABCD1234EFGJ" }, platform);
    const first = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[2][1]?.body));
    expect(first).not.toHaveProperty("credential");
    expect(first.code).toBe("ABCD1234EFGH");
    expect(second.pairRequestId).not.toBe(first.pairRequestId);
  });

  it("refuses a mismatched environment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ token: "test" })).mockResolvedValueOnce(response({ environmentId: "different" })));
    await expect(redeemPairing({ ...payload, environmentId: "expected" }, fakePlatform().platform)).rejects.toMatchObject({ code: "mismatch" });
  });

  it.each([403, 404])("tolerates companion session HTTP %s without inventing privileges", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ token: "test", device: { id: "phone" } })).mockResolvedValueOnce(response({ scopes: ["admin"] }, status)));
    const { record } = await redeemPairing({ ...payload, transport: "companion", origin: "http://companion.test:8810" }, fakePlatform().platform);
    expect(record.environmentId).toBe("http://companion.test:8810");
    expect(record.capabilities).toEqual({ chat: true, uploads: true, computerView: true, computerControl: false, routines: false, settingsWrite: false, notifications: false, openOnDesktop: false });
  });

  it("uses explicit companion capabilities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ token: "test", capabilities: { routines: true } })).mockResolvedValueOnce(response({ capabilities: { computerControl: true } })));
    const { record } = await redeemPairing({ ...payload, transport: "companion" }, fakePlatform().platform);
    expect(record.capabilities).toMatchObject({ routines: true, computerControl: true, notifications: false });
  });

  it("refuses relay, invalid and expired payloads without contacting a server", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { platform } = fakePlatform();
    await expect(redeemPairing({ ...payload, transport: "relay" }, platform)).rejects.toEqual(new PairError("relay-unavailable"));
    await expect(redeemPairing({ ...payload, expiresAt: Date.now() - 1 }, platform)).rejects.toMatchObject({ code: "expired" });
    await expect(redeemPairing({ ...payload, origin: "https://workspace.test/path" }, platform)).rejects.toMatchObject({ code: "invalid" });
    await expect(redeemPairing({ ...payload, credential: "placeholder" }, platform)).rejects.toMatchObject({ code: "invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("connection storage", () => {
  it("keeps tokens out of prefs, replaces matching workspaces and removes secure entries", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/api/pair") ? response({ token: "sensitive-test-token" }) : response({ environmentId: "work" })));
    const { platform, preferences, secrets } = fakePlatform();
    const { record, token } = await redeemPairing(payload, platform);
    const store = createConnectionStore(platform);
    await store.save(record, token);
    expect(await store.active()).toEqual({ record, token });
    expect(JSON.stringify([...preferences.values()])).not.toContain(token);
    expect(secrets.get(`token.${record.id}`)).toBe(token);
    const replacement = { ...record, id: "replacement", sessionRef: "ignored" };
    await store.save(replacement, "replacement-secret");
    expect(await store.list()).toHaveLength(1);
    expect(secrets.has(record.sessionRef)).toBe(false);
    expect((await store.active())?.record.sessionRef).toBe("token.replacement");
    await store.touch("replacement");
    await store.remove("replacement");
    expect(await store.active()).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(secrets.size).toBe(0);
  });
});
