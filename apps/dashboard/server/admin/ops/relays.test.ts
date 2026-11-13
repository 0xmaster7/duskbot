import { describe, expect, it } from "vitest";
import { cleanLimits, createRelays, RelayError } from "./relays.ts";
import { linkAccountRef } from "../../link-grant.ts";

const STATS = {
  relay: "cloudflare", now: { tunnels: 2, accounts: 1, bytesPerSecOut: 10, bytesPerSecIn: 1, cpu: null, rssMb: null }, today: { bytesOut: 5, bytesIn: 1 },
  month: { bytesOut: 50, bytesIn: 9, projectedBytesOut: 100, allowanceBytes: null }, limits: { maxTunnels: 10, paused: false }, busy: false,
  top: [{ account: linkAccountRef("acct_one"), tunnels: 2, bytesToday: 5 }, { account: "f".repeat(32), tunnels: 1, bytesToday: 1 }],
};

function fakeFetch(answer: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer(url, init); }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const accounts = () => [{ id: "acct_one", email: "one@example.test" }];

describe("relay cards", () => {
  it("asks each configured relay with its own token and names the accounts it knows", async () => {
    const { fetcher, calls } = fakeFetch(() => json(200, STATS));
    const relays = createRelays({ env: { DUSK_CF_RELAY_URL: "https://relay-preview.example", DUSK_CF_RELAY_OPS_TOKEN: "cf-token" }, fetch: fetcher, now: () => 1, accounts });
    const { relays: cards } = await relays.list();
    expect(cards.map(card => [card.id, card.configured, card.ok])).toEqual([["contabo", false, false], ["cloudflare", true, true]]);
    expect(cards[0]!.error).toContain("DUSK_LINK_STATS_TOKEN");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://relay-preview.example/ops/relay/stats");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer cf-token");
    expect(cards[1]!.stats!.top[0]).toMatchObject({ accountId: "acct_one", email: "one@example.test" });
    expect(cards[1]!.stats!.top[1]).toMatchObject({ accountId: null, email: null });
  });
  it("shows a relay that refuses the token or is down as failing, without the other failing", async () => {
    const { fetcher } = fakeFetch(url => url.includes("link") ? json(404, { error: "not found" }) : json(200, STATS));
    const relays = createRelays({ env: { DUSK_LINK_URL: "https://link.example", DUSK_LINK_STATS_TOKEN: "a", DUSK_CF_RELAY_URL: "https://cf.example", DUSK_CF_RELAY_OPS_TOKEN: "b" }, fetch: fetcher, now: () => 1, accounts });
    const { relays: cards } = await relays.list();
    expect(cards[0]).toMatchObject({ ok: false, configured: true, stats: null });
    expect(cards[1]).toMatchObject({ ok: true });
  });
  it("sends a limits change as PUT and passes the relay's refusal on as a 400", async () => {
    const { fetcher, calls } = fakeFetch((_url, init) => init.method === "PUT" ? json(400, { error: "maxTunnels must be a whole number" }) : json(200, STATS));
    const relays = createRelays({ env: { DUSK_LINK_STATS_TOKEN: "a" }, fetch: fetcher, now: () => 1, accounts });
    await expect(relays.setLimits("contabo", { maxTunnels: 5 })).rejects.toMatchObject({ status: 400, message: "maxTunnels must be a whole number" });
    expect(calls[0]).toMatchObject({ url: "https://link.dusk.bot/ops/relay/limits", init: { method: "PUT", body: JSON.stringify({ maxTunnels: 5 }) } });
    await expect(relays.setLimits("cloudflare", { maxTunnels: 5 })).rejects.toMatchObject({ status: 409 });
  });
  it("only forwards whole numbers, off and on", () => {
    expect(cleanLimits({ maxTunnels: 5, burstBytes: null, paused: true })).toEqual({ maxTunnels: 5, burstBytes: null, paused: true });
    for (const bad of [{}, { maxTunnels: -1 }, { maxTunnels: 1.5 }, { maxTunnels: "5" }, { "bad key": 1 }, { x: {} }]) expect(() => cleanLimits(bad)).toThrow(RelayError);
  });
  it("gives the local fixture made-up cards whose limits change when edited", async () => {
    const relays = createRelays({ env: {}, now: () => Date.UTC(2026, 10, 13), accounts, fixture: true });
    expect((await relays.list()).relays.every(card => card.ok && card.stats)).toBe(true);
    const card = await relays.setLimits("cloudflare", { paused: true });
    expect(card.stats).toMatchObject({ busy: true, limits: { paused: true } });
  });
});
