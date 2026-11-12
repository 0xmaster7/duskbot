import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING } from "@/lib/onboarding";

const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[], refs: [] as { current: unknown }[], ref: 0, state: {} as any, dispatch: null as any }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = typeof initial === "function" ? initial() : initial;
    return [f.values[index], (next: unknown) => { f.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(f.values[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = f.ref++; f.refs[index] ??= { current: initial }; return f.refs[index]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./mascot-view", () => ({ DuskMark: () => null }));
vi.mock("./ProIntroduction", () => ({ useCloudPlan: () => ({ view: { kind: "signed-out" }, account: null }) }));
vi.mock("./onboarding/WelcomeGate", () => ({ localDesktopPage: () => true }));
vi.mock("./vps-link/parts", () => ({ deviceWord: () => "Mac" }));
import { track } from "@/lib/analytics";
import { api } from "@/state/store";

const bots = (count: number, turns = 1) => Array.from({ length: count }, (_, i) => ({ tasks: [{ threadId: `t${i}`, usage: { turns } }] }));
let storage: Map<string, string>;
let Card: typeof import("./CloudUpsell").SidebarCloudCard;

const render = () => { f.index = 0; f.ref = 0; f.effects = []; return renderToStaticMarkup(createElement(Card)); };
async function settle() { for (let i = 0; i < 3; i++) { render(); f.effects.forEach(effect => effect()); await Promise.resolve(); } return render(); }
/** a new launch: a fresh module, so nothing held from the last one */
async function launch() { vi.resetModules(); Card = (await import("./CloudUpsell")).SidebarCloudCard; f.values = []; f.refs = []; return settle(); }

beforeEach(() => {
  vi.clearAllMocks(); setLocale("en"); storage = new Map(); f.dispatch = vi.fn();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("window", { duskDesktop: {} });
  f.state = { hydrated: true, bots: bots(1), groups: [], routines: [], config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen: [] } } };
  vi.mocked(api).mockImplementation(async (_path, init) => {
    f.state.config.onboarding.hintsSeen = JSON.parse(String((init as RequestInit).body)).onboarding.hintsSeen;
    return f.state.config;
  });
});

describe("the sidebar dusk cloud card", () => {
  it("says the plain 24/7 line, with no nap in it", async () => {
    const html = await launch();
    expect(html).toContain("dusk cloud keeps your bots working, even when your Mac is off.");
    expect(html).not.toMatch(/\bnap/i);
    expect(track).toHaveBeenCalledWith("upsell_shown", { source: "app_sidebar" });
  });

  it("switches to their own numbers once someone is invested, counted as app_invested, once per account", async () => {
    f.state.bots = bots(3);
    const html = await launch();
    expect(html).toContain("data-invested");
    expect(html).toContain("good crew of bots");
    expect(html).toContain("dusk cloud keeps them working, even when your Mac is off.");
    expect(track).toHaveBeenCalledWith("upsell_shown", { source: "app_invested" });
    expect(track).not.toHaveBeenCalledWith("upsell_shown", { source: "app_sidebar" });
    expect(f.state.config.onboarding.hintsSeen).toContain("cloud-invested-v1");
    expect(await settle(), "holds for the rest of the launch").toContain("good crew of bots");
    expect(await launch(), "the next launch is back to the plain card").not.toContain("data-invested");
  });

  it("quotes messages and routines too", async () => {
    f.state.bots = [...bots(1, 25), ...bots(1, 25)];
    expect(await launch()).toContain("heavy workload");
    f.state.bots = bots(1); f.state.config.onboarding.hintsSeen = []; storage.clear(); f.state.routines = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(await launch()).toContain("routines are doing real work");
  });

  it("Get dusk cloud opens Add a Cloud as app_invested; closing snoozes the card like any other", async () => {
    f.state.bots = bots(3);
    await launch();
    f.index = 0; f.ref = 0;
    const element = (Card as () => unknown)() as any;
    const buttons: any[] = [];
    const walk = (node: any) => { if (!node || typeof node !== "object") return; if (node.type === "button") buttons.push(node); [node.props?.children].flat().forEach(walk); };
    walk(element);
    buttons.find(button => button.props["data-sidebar-cloud-start"] === "").props.onClick();
    expect(f.dispatch).toHaveBeenCalledWith({ type: "openCloudAdd", source: "app_invested", signIn: true });
    expect(track).toHaveBeenCalledWith("upsell_click", { source: "app_invested", ms: expect.any(Number) });
    buttons.find(button => button.props["aria-label"] === "hide for a few days").props.onClick();
    expect(track).toHaveBeenCalledWith("upsell_dismiss", { source: "app_invested" });
    expect(storage.has("dusk-cloud-sidebar-card-until")).toBe(true);
  });

  it("waits below every threshold", async () => {
    f.state.bots = [...bots(1, 25), ...bots(1, 24)];
    expect(await launch()).not.toContain("data-invested");
  });
});
