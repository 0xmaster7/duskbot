import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./analytics", () => ({ track: vi.fn() }));
import { track } from "./analytics";
import { INVESTED, investedBy, snoozed, snoozeUntil, SNOOZE_DAYS } from "../../shared/cloud-upsell";
import { alwaysOnCooling, ALWAYS_ON_COOLDOWN, cloudUpsellAllowed, investedFacts, markAlwaysOn, sidebarCardSnoozed, snoozeSidebarCard, trackUpsell } from "./cloud-upsell";

const DAY = 86_400_000, NOW = new Date(2026, 10, 12, 12).getTime();
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("calls someone invested at 3 bots, 50 messages or 3 routines, and not one short of any", () => {
  expect(INVESTED).toEqual({ bots: 3, messages: 50, routines: 3 });
  expect(investedBy({ bots: 2, messages: 49, routines: 2 })).toBeNull();
  expect(investedBy({ bots: 3, messages: 0, routines: 0 })).toBe("bots");
  expect(investedBy({ bots: 0, messages: 50, routines: 0 })).toBe("messages");
  expect(investedBy({ bots: 0, messages: 0, routines: 3 })).toBe("routines");
  expect(investedBy({ bots: 5, messages: 500, routines: 5 })).toBe("bots");
});

it("counts visible bots, every task's and room's turns, and routines", () => {
  const facts = investedFacts({
    bots: [{ tasks: [{ usage: { turns: 10 } }, { usage: null }] }, { hidden: true, tasks: [{ usage: { turns: 99 } }] }, { movedTo: { place: "x" } }, { tasks: [{ usage: { turns: 5 } }] }],
    groups: [{ usage: { turns: 7 } }, {}],
    routines: [{}, {}],
  });
  expect(facts).toEqual({ bots: 2, messages: 22, routines: 2 });
});

it("snoozes the sidebar card for some days, then brings it back", () => {
  expect(sidebarCardSnoozed(NOW)).toBe(false);
  snoozeSidebarCard(NOW);
  expect(sidebarCardSnoozed(NOW + DAY)).toBe(true);
  expect(sidebarCardSnoozed(NOW + (SNOOZE_DAYS - 1) * DAY)).toBe(true);
  expect(sidebarCardSnoozed(NOW + SNOOZE_DAYS * DAY + 1)).toBe(false);
  expect(snoozed("garbage", NOW)).toBe(false);
  expect(snoozed(String(snoozeUntil(NOW)), NOW)).toBe(true);
});

it("says 24/7 once per cooldown, shared by the inline note and the new-routine dialog", () => {
  expect(alwaysOnCooling(NOW)).toBe(false);
  markAlwaysOn(NOW);
  expect(alwaysOnCooling(NOW + DAY)).toBe(true);
  expect(alwaysOnCooling(NOW + ALWAYS_ON_COOLDOWN + 1)).toBe(false);
});

it("is hidden with a cloud, an organization, off this computer's page, and waits while loading", () => {
  expect(cloudUpsellAllowed({ here: true, view: { kind: "signed-out" }, managed: false })).toBe(true);
  expect(cloudUpsellAllowed({ here: true, view: { kind: "free" }, managed: false })).toBe(true);
  expect(cloudUpsellAllowed({ here: true, view: { kind: "paid", label: "Pro", checking: false }, managed: false })).toBe(false);
  expect(cloudUpsellAllowed({ here: true, view: { kind: "attention", label: null }, managed: false })).toBe(false);
  expect(cloudUpsellAllowed({ here: true, view: { kind: "free" }, managed: true })).toBe(false);
  expect(cloudUpsellAllowed({ here: false, view: { kind: "free" }, managed: false })).toBe(false);
  expect(cloudUpsellAllowed({ here: true, view: { kind: "unknown" }, managed: false })).toBeNull();
  expect(cloudUpsellAllowed({ here: true, view: { kind: "free" }, managed: null })).toBeNull();
});

it("reports each step with its checkout source", () => {
  trackUpsell("shown", "app_sidebar"); trackUpsell("click", "app_always_on"); trackUpsell("dismiss", "app_invested");
  expect(vi.mocked(track).mock.calls).toEqual([["upsell_shown", { source: "app_sidebar" }], ["upsell_click", { source: "app_always_on" }], ["upsell_dismiss", { source: "app_invested" }]]);
});
