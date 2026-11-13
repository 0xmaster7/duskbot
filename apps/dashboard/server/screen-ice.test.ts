import { expect, it, vi } from "vitest";
import { cleanIceServers, SCREEN_ICE_TTL_S, screenIceMinterFromEnv } from "./screen-ice.ts";

const cloudflare = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" },
  ],
};

it("keeps Cloudflare's servers without port 53 and drops anything else", () => {
  expect(cleanIceServers(cloudflare)).toEqual([
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" },
  ]);
  expect(cleanIceServers({ iceServers: { urls: "turn:turn.cloudflare.com:3478", username: "u", credential: "c" } })).toHaveLength(1);
  expect(cleanIceServers({ iceServers: [{ urls: ["turn:evil.example:3478"], username: "u", credential: "c" }, { urls: ["turn:turn.cloudflare.com:3478"] }] })).toEqual([]);
  expect(cleanIceServers(null)).toEqual([]);
});

it("is off without a TURN key, and mints with the key only server-side", async () => {
  expect(screenIceMinterFromEnv({})).toBeNull();
  const fetch = vi.fn(async () => new Response(JSON.stringify(cloudflare), { status: 201 })) as unknown as typeof globalThis.fetch;
  const minter = screenIceMinterFromEnv({ DUSK_CF_TURN_KEY_ID: "key-id-0123456789", DUSK_CF_TURN_KEY_TOKEN: "secret-token" }, fetch)!;
  const answer = await minter.mint(1_000);
  expect(answer).toMatchObject({ v: 1, expiresAt: 1_000 + SCREEN_ICE_TTL_S * 1000 });
  expect(JSON.stringify(answer)).not.toContain("secret-token");
  const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
  expect(url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key-id-0123456789/credentials/generate-ice-servers");
  expect(init.headers.authorization).toBe("Bearer secret-token");
  const refused = screenIceMinterFromEnv({ DUSK_CF_TURN_KEY_ID: "key-id-0123456789", DUSK_CF_TURN_KEY_TOKEN: "t" }, (async () => new Response("no", { status: 401 })) as unknown as typeof globalThis.fetch)!;
  expect(await refused.mint(0)).toBeNull();
});
