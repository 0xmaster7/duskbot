// the public edge in front of two account services on one public domain (preview and production)
import { afterEach, expect, it, vi } from "vitest";
import { askWake, lookupRoute, routeServices } from "../edge/route.js";

const PREVIEW = "https://preview.example.test", PRODUCTION = "https://prod.example.test";
const env = { ROUTE_URL: `${PRODUCTION}, ${PREVIEW}`, EDGE_TOKEN: `${"p".repeat(40)},${"v".repeat(40)}` };
afterEach(() => vi.unstubAllGlobals());
const label = (n: number) => `d${n.toString(16).padStart(20, "0")}`;

function services(homes: Record<string, Record<string, string>>, down: string[] = []) {
  const calls: Array<{ origin: string; path: string; token: string | null }> = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input), token = new Headers(init?.headers).get("authorization");
    calls.push({ origin: url.origin, path: url.pathname, token });
    if (down.includes(url.origin)) return new Response("down", { status: 502 });
    const upstream = homes[url.origin]?.[url.searchParams.get("label")!];
    if (!upstream) return new Response("{}", { status: 404 });
    return url.pathname.endsWith("/wake") ? new Response("{}", { status: 202 }) : Response.json({ upstream, awake: false, wakeable: true });
  });
  return calls;
}

it("reads one origin and token, or several in order with one token each or one for all", () => {
  expect(routeServices({ ROUTE_URL: PREVIEW, EDGE_TOKEN: "t".repeat(40) })).toEqual([{ origin: PREVIEW, token: "t".repeat(40) }]);
  expect(routeServices(env).map(item => item.origin)).toEqual([PRODUCTION, PREVIEW]);
  expect(routeServices({ ROUTE_URL: `${PRODUCTION},${PREVIEW}`, EDGE_TOKEN: "t".repeat(40) }).map(item => item.token)).toEqual(["t".repeat(40), "t".repeat(40)]);
  expect(() => routeServices({ ROUTE_URL: `${PRODUCTION},${PREVIEW},https://x.test`, EDGE_TOKEN: env.EDGE_TOKEN })).toThrow();
});

it("finds a label at whichever service has it, and sends its wake there with that service's token", async () => {
  const calls = services({ [PREVIEW]: { [label(1)]: "https://home-1.provider.test" }, [PRODUCTION]: { [label(2)]: "https://home-2.provider.test" } });
  expect(await lookupRoute(label(1), env)).toEqual({ upstream: "https://home-1.provider.test", awake: false, wakeable: true });
  expect(await askWake(label(1), "client", env)).toBe(202);
  expect(calls.at(-1)).toEqual({ origin: PREVIEW, path: "/v1/managed/edge/wake", token: `Bearer ${"v".repeat(40)}` });
  expect(await askWake(label(2), "webhook", env)).toBe(202);
  expect(calls.at(-1)).toEqual({ origin: PRODUCTION, path: "/v1/managed/edge/wake", token: `Bearer ${"p".repeat(40)}` });
  expect(await lookupRoute(label(3), env)).toBeNull();
});

it("never calls a label missing while a service that might know it is down", async () => {
  services({ [PREVIEW]: {} }, [PRODUCTION]);
  await expect(lookupRoute(label(4), env)).rejects.toThrow("route lookup failed");
  services({ [PREVIEW]: { [label(5)]: "https://home-5.provider.test" } }, [PRODUCTION]);
  expect(await lookupRoute(label(5), env)).toMatchObject({ upstream: "https://home-5.provider.test" });
});
