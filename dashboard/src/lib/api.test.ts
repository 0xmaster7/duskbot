import { afterEach, expect, test, vi } from "vitest";
import { CSRF_COOKIE, CSRF_HEADER } from "../data/wire";

const catalog = {
  licenses: [], desktops: [], bundles: [], regions: [], creditPacks: [], defaultRegion: "eu", yearlyDiscountPercent: 0, freeWorkUntil: null,
  dedicated: { baseCents: 0, perVcpuCents: 0, perGbRamCents: 0, includedDiskGb: 0, per10GbDiskCents: 0, vcpu: { min: 1, max: 8, step: 1 }, ramGb: { min: 1, max: 8, step: 1 }, diskGb: { min: 10, max: 100, step: 10 } },
};

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test("plan and credit checkouts send their source next to the wire kind", async () => {
  const fetch = vi.fn(async (path: string, _init?: RequestInit) => Response.json(path.endsWith("catalog") ? catalog : { checkoutUrl: "https://checkout.example.test", checkoutId: "checkout" }));
  vi.stubGlobal("fetch", fetch);
  const { api } = await import("./api");
  await api.checkout({ kind: "plan", source: "dash_routines", bundle: null, selection: { desktop: "shared-s", license: "personal", members: 1, interval: "month", region: "eu", size: null } });
  await api.checkout({ kind: "credits", source: "dash_credits", pack: "credits-10" });
  const requests = fetch.mock.calls.filter(([path]) => path.endsWith("checkout"));
  expect(JSON.parse((requests[0]![1] as RequestInit).body as string)).toEqual({ kind: "cart", source: "dash_routines", cart: { interval: "month", license: { kind: "none" }, desktop: { kind: "shared_s", region: "eu" } } });
  expect(JSON.parse((requests[1]![1] as RequestInit).body as string)).toEqual({ kind: "credits", source: "dash_credits", pack: "credits-10" });
});

test("Slack wake uses the cloud route and PUT includes the session and CSRF header", async () => {
  const answer = { available: true, enabled: false, state: "off", bots: 0, buffered: 0 };
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => Response.json(answer));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("document", { cookie: `${CSRF_COOKIE}=fixture-csrf` });
  const { api } = await import("./api");
  expect(await api.slackWake("desktop/id")).toEqual(answer);
  await api.setSlackWake("desktop/id", true);
  expect(fetch.mock.calls[0]![0]).toBe("/v1/clouds/desktop%2Fid/slack-wake");
  expect(fetch.mock.calls[1]).toEqual(["/v1/clouds/desktop%2Fid/slack-wake", expect.objectContaining({ method: "PUT", credentials: "same-origin", body: JSON.stringify({ enabled: true }), headers: expect.objectContaining({ [CSRF_HEADER]: "fixture-csrf" }) })]);
});

test("catalog wake mapping preserves measured stats under dashboard desktop ids", async () => {
  const { catalogFromWire } = await import("../data/live");
  const measured = { shared_s: { medianMs: 700, p90Ms: 1500, samples: 30 }, shared_m: { medianMs: 4200, p90Ms: 6000, samples: 40 }, dedicated: { medianMs: 12_000, p90Ms: 20_000, samples: 50 } };
  const wire = { v: 1, currency: "USD", graceDays: 7, ...catalog } as const;
  expect(catalogFromWire(wire).wake).toBeUndefined();
  expect(catalogFromWire({ ...wire, wake: measured }).wake).toEqual({ "shared-s": measured.shared_s, "shared-m": measured.shared_m, dedicated: measured.dedicated });
});

test("fixtures accept checkout sources and retain the Slack wake switch state", async () => {
  vi.stubGlobal("location", { search: "?fixture=cloud" });
  vi.stubGlobal("sessionStorage", { setItem: vi.fn() });
  const { api } = await import("./api");
  const { clouds } = await api.clouds();
  expect((await api.catalog()).wake).toBeUndefined();
  expect(await api.slackWake(clouds[0]!.id)).toEqual({ available: true, enabled: false, state: "off", bots: 0, buffered: 0 });
  expect((await api.setSlackWake(clouds[0]!.id, true)).enabled).toBe(true);
  expect((await api.slackWake(clouds[0]!.id)).enabled).toBe(true);
  expect(await api.checkout({ kind: "credits", source: "dash_credits", pack: "credits-10" })).toEqual({ url: "", id: expect.any(String) });
});
