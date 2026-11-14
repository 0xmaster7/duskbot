// @vitest-environment happy-dom
// The first run as a funnel: the welcome, a dusk bot account, where the bots live, an AI,
// bots from another app when there are some, the phone while its app is offered (with the help-improve line on the last
// screen), then Dusk's chat;
// on dusk cloud, the Cloud being made. What each step shows, where it goes, and what it saves.
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import type { InstanceInfo } from "@/state/store";
import { resetBringRunForTests } from "@/lib/first-run-import";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), onDone: vi.fn(),
  improve: [] as unknown[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn() }), api: f.api }));
vi.mock("@/state/api", () => ({ api: f.api }));
// the directory has its own tests; here only that More providers opens it
vi.mock("@/components/models/ModelDirectory", () => ({ ModelDirectory: () => null }));
vi.mock("@/lib/product-analytics", () => ({ setUsageAnalytics: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/components/mascot-clock", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/EngineSetup", async (original) => {
  const { createElement: h } = await import("react");
  return { ...(await original<typeof import("@/components/EngineSetup")>()),
    EngineSetup: ({ instance }: { instance: InstanceInfo }) => h("div", { "data-engine-setup": instance.instanceId }) };
});
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
const { WelcomeFlow } = await import("./WelcomeFlow");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const claude = (ready: boolean, aiTest?: InstanceInfo["aiTest"]): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", install: { docsUrl: "https://example.test" },
  snapshot: { state: ready ? "available" : "unavailable", authenticated: ready }, models: { default: "m", options: [] }, ...(aiTest ? { aiTest } : {}),
} as InstanceInfo);
const signedOut = (instanceId: string, driverKind: string, displayName: string, method = "paste-code"): InstanceInfo => ({
  instanceId, driverKind, displayName, access: "subscription", install: { docsUrl: "https://example.test" },
  snapshot: { state: "available", authenticated: false }, authentication: { method }, models: { default: "m", options: [] },
} as InstanceInfo);
const cursor = (ready: boolean): InstanceInfo => ({ ...claude(ready), instanceId: "cursor", driverKind: "cursorAgent", displayName: "Cursor", aiTest: "passed" } as InstanceInfo);
const freeOpenCode = {
  instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", install: { docsUrl: "https://example.test" },
  snapshot: { state: "available", authenticated: true, freeFallback: true }, models: { default: "opencode/big-pickle", options: [] }, aiTest: "passed",
} as InstanceInfo;
const nothingSignedIn = () => [signedOut("chatgpt", "codex", "ChatGPT plan", "browser-pkce"), signedOut("claude", "claudeAgent", "Claude"),
  signedOut("cursor", "cursorAgent", "Cursor", "device-code"), signedOut("githubCopilot", "copilotAgent", "GitHub Copilot", "device-code")];
const maus = { id: "maus", threadId: "t", name: "Dusk", title: "", description: "", notifications: true, color: "chrome", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], defaultBot: {}, chiefOfStaff: true };

let host: HTMLDivElement, root: Root;
const text = () => document.body.textContent ?? "";
const step = () => document.body.querySelector<HTMLElement>("[data-welcome]")?.dataset.welcome;
const title = () => document.body.querySelector("#welcome-title")?.textContent;
const button = (label: string) => [...document.body.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no "${label}" button on ${step()}: ${text()}`);
  await act(async () => { target.click(); });
  await settle();
};
const choose = async (selector: string) => {
  await act(async () => { document.body.querySelector<HTMLElement>(selector)!.click(); });
  await settle();
};
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); };
const key = async (name: string) => {
  await act(async () => { document.body.querySelector<HTMLElement>("[data-welcome]")!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  await settle();
};
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, ...extra })); });
  await settle();
};
/** An AI already answering is used without asking: the AI step says so, then goes on by itself. */
const usesFoundAi = async (name = "Claude") => {
  expect(step()).toBe("ai");
  expect(text()).toContain(`Using your ${name} account`);
  expect(document.body.querySelector("[data-funnel-ai]"), "no cards to pick from").toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_400); });
  await settle();
};
const saved = () => f.api.mock.calls.filter(([path, init]) => path === "/api/config" && init?.method === "PUT").map(([, init]) => JSON.parse(init.body));
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, String(v)), removeItem: (k: string) => void values.delete(k), clear: () => values.clear() };
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.animate = vi.fn(() => ({ onfinish: null, oncancel: null, cancel() {} }) as unknown as Animation);
  setLocale("en");
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  f.dispatch.mockReset();
  f.onDone.mockReset();
  f.api.mockReset();
  f.improve = [];
  resetBringRunForTests();
  f.api.mockImplementation(async (path: string, init?: { body?: string; method?: string }) => {
    if (path.endsWith("/check")) return { ok: true };
    if (path === "/api/dashboard/usage-signals") { if (init?.body) f.improve.push(JSON.parse(init.body)); return init?.body ? JSON.parse(init.body) : { enabled: true }; }
    if (path === "/api/mobile/devices") return { devices: [] };
    if (path === "/api/setup-import/bots") return { apps: [] };
    if (path === "/api/setup-import/grok") return { files: [], bots: [] };
    return path === "/api/instances" ? { instances: f.state.instances } : JSON.parse(init?.body ?? "{}");
  });
  f.state = { hydrated: true, instances: [claude(true, "passed")], config: { onboarding: EMPTY_ONBOARDING, profile: { name: "" } }, bots: [maus], cloudAdd: null };
  stageIntro(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the welcome", () => {
  it("opens on the welcome with nothing else to decide, and asks nothing about sharing off the desktop app", async () => {
    await show();
    expect(step()).toBe("welcome");
    expect(title()).toBe("Meet dusk bot");
    await press("Get started");
    expect(step()).toBe("ai");
    expect(document.body.querySelector("[data-help-improve]"), "Settings has the switch; the run here has no place step").toBeNull();
    expect(f.onDone).not.toHaveBeenCalled();
    expect(document.body.querySelector("textarea"), "nothing asks for a job").toBeNull();
  });

  it("help improve is one quiet line at the foot of the place step, on by default and saved when switched off", async () => {
    vi.stubGlobal("duskDesktop", { remoteClient: { active: false } });
    await show();
    expect(step()).toBe("place");
    const line = document.body.querySelector<HTMLElement>("[data-help-improve]")!;
    expect(line.textContent).toBe("Share anonymous usage statistics and crash reports to help improve dusk bot. Never your messages, files or keys.");
    expect(line.className).toContain("text-[12px]");
    const toggle = line.querySelector<HTMLButtonElement>("[role=switch]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => { toggle.click(); });
    await settle();
    expect(f.improve).toEqual([{ enabled: false }]);
  });

  it("with Claude already answering, uses it without asking and goes on to Dusk's chat", async () => {
    await show();
    await press("Get started");
    await usesFoundAi();
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus")).toBe(true);
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
    await act(async () => {});
    expect(saved()).toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT] }) }]);
  });
});

describe("connecting an AI", () => {
  it("shows every AI as a button with its name, and opens the picked one's own sign-in under the grid", async () => {
    f.state = { ...f.state, instances: nothingSignedIn() };
    await show();
    await press("Get started");
    expect(step()).toBe("ai");
    expect(title()).toBe("Connect an AI");
    expect([...document.body.querySelectorAll<HTMLElement>("[data-funnel-ai]")].map((tile) => tile.dataset.funnelAi)).toEqual(["chatgpt", "claude", "cursor", "copilot"]);
    expect(text()).toContain("ChatGPT");
    f.api.mockImplementation(async (path: string) => {
      if (path === "/api/instances?fresh=1") return { instances: f.state.instances };
      if (path === "/api/instances/claude/auth/start") return { auth: { phase: "waiting", flowId: "c1", authorizationUrl: "https://claude.ai/oauth/authorize?x=1" } };
      return {};
    });
    await press("Claude");
    expect(document.body.querySelector("[data-funnel-ai-connect=claude]")).not.toBeNull();
    expect(document.body.querySelector("[data-sign-in=paste]"), "the sign-in opened in the browser, the code goes here").not.toBeNull();
    expect(f.api).toHaveBeenCalledWith("/api/instances/claude/auth/start", expect.objectContaining({ method: "POST" }));
    await press("ChatGPT");
    expect(f.api, "picking another cancels the one under way").toHaveBeenCalledWith("/api/instances/claude/auth/cancel", expect.objectContaining({ method: "POST" }));
    expect(document.body.querySelector("[data-funnel-ai-connect=claude]")).toBeNull();
    await press("More providers or use an API key");
    expect(document.body.querySelector("[data-connect-ai]")).not.toBeNull();
    expect(document.body.querySelector("[data-connect-ai] h2")?.textContent, "it opens on every other provider").toBe("More providers or use an API key");
  });

  it("shows connected AIs as connected, not to be pressed again, with continue ready and more still to add", async () => {
    f.state = { ...f.state, instances: nothingSignedIn() };
    await show();
    await press("Get started");
    expect(button("Continue")?.disabled, "nothing connected yet: Continue waits, Set up later goes on").toBe(true);
    expect(button("Set up later")?.className).not.toContain("ui-button-primary");
    expect(document.body.querySelectorAll("[data-funnel-ai-continue], [data-funnel-later]")).toHaveLength(2);
    const focus = vi.fn(async () => true);
    vi.stubGlobal("duskDesktop", { focusWindow: focus });
    f.state = { ...f.state, instances: [cursor(true), { ...claude(true), instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" } as InstanceInfo, signedOut("claude", "claudeAgent", "Claude")] };
    await show();
    expect(title()).toBe("Connect an AI");
    const connected = [...document.body.querySelectorAll<HTMLElement>("[data-funnel-ai][data-connected]")].map((tile) => tile.dataset.funnelAi);
    expect(connected).toEqual(["chatgpt", "cursor"]);
    expect(document.body.querySelector("[data-funnel-ai=cursor]")?.tagName, "a connected AI is not a button").toBe("DIV");
    expect(document.body.querySelector("[data-funnel-ai=cursor]")?.textContent).toContain("Connected");
    expect(focus, "a sign-in that finished brings the app back").toHaveBeenCalled();
    expect(button("Set up later")).toBeUndefined();
    expect(button("Continue")?.className).toContain("ui-button-primary");
    expect(document.body.querySelector("button[data-funnel-ai=claude]"), "another can still be added").not.toBeNull();
    await press("Continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });

  it("set up later, or the free model, goes on; a found sign-in that didn't answer says why", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, ...nothingSignedIn()] };
    await show();
    await press("Get started");
    expect(button("Start with the free model"), "Set up later starts on the free model instead").toBeUndefined();
    await press("Set up later");
    expect(f.onDone).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = createRoot(host);
    f.onDone.mockReset();
    f.state = { ...f.state, instances: [claude(true, "failed")] };
    await show({ initialBeat: "ai" });
    expect(document.body.querySelector("[role=alert]")?.textContent).toContain("Claude");
  });
});

describe("on the desktop app", () => {
  const desktop = (extra: Record<string, unknown> = {}) => vi.stubGlobal("duskDesktop", { remoteClient: { active: false }, requireUserPresence: async () => true, ...extra });

  it("opens a server from the app on its AI, without the hello the person already saw", async () => {
    desktop({ remoteClient: { active: true } });
    await show();
    expect(step()).toBe("ai");
    expect(document.body.querySelector("[data-funnel-progress]"), "one screen has no progress to show").toBeNull();
  });

  it("opens on where bots live (the hello is part of it), then the AI, what to bring and the chat, with back and progress", async () => {
    desktop({ platform: "linux" });
    await show();
    expect(step(), "no separate hello screen to click through").toBe("place");
    expect(title()).toBe("Where should your bots live?");
    expect(document.body.querySelector("[data-funnel-progress]")?.getAttribute("data-funnel-progress")).toBe("1/3");
    expect(text()).toContain("This computer");
    expect(text(), "never a Mac on Linux").not.toContain("Mac");
    expect(text()).toContain("dusk cloud");
    expect(text()).toContain("From $20 a month");
    await choose("[data-funnel-place=mac]");
    expect(document.querySelector("[data-panel-modal]"), "the free way never asks again").toBeNull();
    expect(document.body.querySelector("[data-help-improve]"), "only on the place step").toBeNull();
    await usesFoundAi();
    expect(step()).toBe("bring");
    expect(document.body.querySelector("[data-help-improve]"), "never on a later screen").toBeNull();
    await press("Back");
    expect(step()).toBe("ai");
    expect(document.body.querySelector("[data-funnel-ai=claude]")?.hasAttribute("data-connected"), "back on the step: the cards, Claude connected").toBe(true);
    await press("Continue");
    await press("Continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(document.body.querySelector(".phone-frame"), "the phone app is hidden").toBeNull();
  });

  it("with the phone app offered, ends on the phone: a code to scan, then the chat", async () => {
    vi.stubEnv("VITE_DUSK_PHONE_APP", "1");
    desktop({ platform: "linux" });
    await show({ initialBeat: "place" });
    expect(document.body.querySelector("[data-funnel-progress]")?.getAttribute("data-funnel-progress")).toBe("1/4");
    await choose("[data-funnel-place=mac]");
    expect(document.body.querySelector("[data-help-improve]"), "only on the place step").toBeNull();
    await usesFoundAi();
    expect(step()).toBe("bring");
    await press("Continue");
    expect(step()).toBe("phone");
    expect(document.body.querySelector(".phone-frame img"), "the phone app's own screen").not.toBeNull();
    expect(document.body.querySelector("[data-help-improve]"), "never on a later screen").toBeNull();
    expect(button("Skip")?.className, "skip is a real button").toContain("ui-button-lg");
    await press("Back");
    expect(step()).toBe("bring");
    await press("Continue");
    await press("Show the code");
    expect(document.body.querySelector("[data-phone-offer]")).not.toBeNull();
    await press("Continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });

  it("this computer just goes on to the AI, with no dusk cloud sheet in between", async () => {
    desktop({ platform: "darwin", cloudAccount: { state: async () => ({ status: "signed-out" }), onState: () => () => {}, offer: vi.fn(async () => ({ plans: [{ tier: "starter", amount: 1500 }] })) } });
    await show({ initialBeat: "place" });
    await choose("[data-funnel-place=mac]");
    expect(document.querySelector("[data-panel-modal]")).toBeNull();
    expect(step()).toBe("ai");
  });

  it("a double click that opened the place step does not also choose there", async () => {
    desktop();
    await show();
    const second = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 });
    await act(async () => { document.body.querySelector<HTMLElement>("[data-funnel-place=mac]")!.dispatchEvent(second); });
    await settle();
    expect(step()).toBe("place");
    await choose("[data-funnel-place=mac]");
    expect(step()).toBe("ai");
  });

  const cloudBridge = (start: Record<string, unknown>) => {
    let listener: ((next: unknown) => void) | null = null;
    const bridge = {
      now: start as unknown,
      state: vi.fn(async () => bridge.now), refresh: vi.fn(async () => bridge.now), cancel: vi.fn(async () => bridge.now),
      onState: (cb: (next: unknown) => void) => { listener = cb; return () => {}; },
      continueInBrowser: vi.fn(async () => ({ outcome: "opened", state: bridge.now })),
      offer: vi.fn(async () => ({ plans: [{ tier: "starter", amount: 1500, trialDays: 7 }, { tier: "pro", amount: 2900, trialDays: 7 }], recommended: "pro" })),
      holdSignIns: vi.fn(async () => ({ outcome: "held" })), connectHome: vi.fn(async () => ({ status: "connected" })),
      tell: async (next: unknown) => { bridge.now = next; await act(async () => { listener?.(next); }); await settle(); },
    };
    return bridge;
  };

  it("dusk cloud's tile says the trial and the price before anything is asked for", async () => {
    desktop({ cloudAccount: cloudBridge({ status: "connected", clouds: [] }) });
    await show();
    const tile = document.body.querySelector("[data-funnel-place=cloud]")!;
    expect(tile.textContent).toContain("7 days free");
    expect(tile.querySelector("[data-funnel-place-note]")?.textContent).toBe("Then from $15/month + tax where applicable.");
  });

  it("dusk cloud goes straight to the browser with its intent and waits calmly; back and this Mac are one press away", async () => {
    const bridge = cloudBridge({ status: "signed-out" });
    bridge.continueInBrowser.mockImplementation(async () => { bridge.now = { status: "connecting" }; return { outcome: "browser", state: bridge.now }; });
    desktop({ cloudAccount: bridge });
    await show();
    await choose("[data-funnel-place=cloud]");
    expect(step()).toBe("checkout");
    expect(bridge.continueInBrowser).toHaveBeenCalledExactlyOnceWith({ kind: "upgrade", source: "app_onboarding", move: "computer" });
    expect(title()).toBe("Continue in your browser");
    expect(text()).toContain("Create your account, pick a plan and check out");
    expect(text()).toContain("Waiting for your sign-in");
    expect(document.body.querySelector("[data-funnel-checkout-price]"), "no price line while the browser asks for money").toBeNull();
    expect(text()).not.toContain("/month");
    expect(document.body.querySelector("[data-funnel-checkout-mac]")?.className, "this Mac is a light, small text link").toContain("text-ink-tertiary");
    expect(document.body.querySelector("[data-funnel-progress]")?.getAttribute("data-funnel-progress"), "place, checkout, ai, making").toBe("2/4");
    expect(text(), "no dash anywhere").not.toMatch(/\u2014/);
    await bridge.tell({ status: "connected", account: { email: "sam@qa.dusk.test" }, clouds: [] });
    expect(text(), "Signed in: the plan and checkout are what is left").toContain("Waiting for your checkout");
    expect(document.body.querySelector("[data-funnel-checkout-email]")?.textContent).toBe("Signed in as sam@qa.dusk.test.");
    await press("Open the page again");
    expect(bridge.continueInBrowser).toHaveBeenCalledTimes(2);
    await press("Back");
    expect(step()).toBe("place");
    await choose("[data-funnel-place=cloud]");
    await press("Use this computer instead");
    expect(step(), "this Mac's own steps, with no dead end").toBe("ai");
  });

  it("in strict mode (mounted twice) still hears the browser and the payment", async () => {
    const bridge = cloudBridge({ status: "connected", clouds: [] });
    desktop({ cloudAccount: bridge });
    await act(async () => { root.render(createElement(StrictMode, null, createElement(WelcomeFlow, { onDone: f.onDone }))); });
    await settle();
    await choose("[data-funnel-place=cloud]");
    expect(text()).toContain("Waiting for your checkout");
    await bridge.tell({ status: "connected", clouds: [{ id: "c1", primary: true, runsOn: "cloud", status: "setting_up" }] });
    expect(step()).toBe("ai");
  });

  it("a sign-in still waiting in the browser is let go when the person picks this Mac instead", async () => {
    const bridge = cloudBridge({ status: "signed-out" });
    bridge.continueInBrowser.mockImplementation(async () => { bridge.now = { status: "connecting" }; return { outcome: "browser", state: bridge.now }; });
    desktop({ cloudAccount: bridge });
    await show();
    await choose("[data-funnel-place=cloud]");
    await press("Use this computer instead");
    expect(bridge.cancel).toHaveBeenCalledOnce();
  });

  it("says so when the browser can't open, and offers the page again", async () => {
    const bridge = cloudBridge({ status: "signed-out" });
    bridge.continueInBrowser.mockImplementation(async () => { throw new Error("no browser"); });
    desktop({ cloudAccount: bridge });
    await show();
    await choose("[data-funnel-place=cloud]");
    expect(document.body.querySelector("[role=alert]")?.textContent).toContain("Your browser didn't open.");
    expect(button("Open the page again")).toBeDefined();
  });

  it("on dusk cloud: paid in the browser, the AI while the Cloud is made, its sign-ins held, and its chat once ready", async () => {
    const own = (status: string, extra: Record<string, unknown> = {}) => ({ status: "connected", clouds: [{ id: "c1", primary: true, runsOn: "cloud", status, origin: status === "ready" ? "https://c1.dusk.test" : null, ...extra }] });
    const bridge = cloudBridge({ status: "connected", clouds: [] });
    f.state = { ...f.state, instances: [freeOpenCode, ...nothingSignedIn()] };
    desktop({ cloudAccount: bridge });
    await show();
    await choose("[data-funnel-place=cloud]");
    expect(step()).toBe("checkout");
    expect(text(), "already signed in: the plan and checkout are what is left").toContain("Waiting for your checkout");
    await bridge.tell(own("setting_up", { setup: { step: "storage", progress: 0.4 } }));
    expect(step(), "paid: the app notices by itself and the AI comes next").toBe("ai");
    expect(text()).toContain("Your cloud is getting ready.");
    expect(document.body.querySelector("[data-funnel-back]"), "no way back to a purchase that is done").toBeNull();
    expect(document.body.querySelector("[data-funnel-progress]")?.getAttribute("data-funnel-progress")).toBe("3/4");
    await press("Set up later");
    expect(step()).toBe("making");
    expect(title()).toBe("Making your cloud");
    expect(document.body.querySelector("[data-funnel-making]")?.getAttribute("data-funnel-making")).toBe("setting-up");
    expect(document.body.querySelector("[aria-current=step]")?.textContent).toBe("Preparing storage");
    expect(bridge.holdSignIns).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("dusk.onboarding.welcomeDraft")!), "a closed app comes back here").toMatchObject({ beat: "making", cloud: true });
    await bridge.tell(own("ready"));
    expect(bridge.connectHome).toHaveBeenCalledOnce();
    expect(f.onDone).toHaveBeenCalledOnce();
  });

  it("never asks for an account on this Mac's way where the app works without one", async () => {
    desktop({ accountGate: { state: async () => ({ required: false, blocked: false, status: "signed-out" }), options: async () => ({ providers: ["google"], recovery: true }), onChange: () => () => {} } });
    await show();
    await choose("[data-funnel-place=mac]");
    expect(step(), "straight on to the AI, signed out").toBe("ai");
  });

  it("where the install requires an account, asks for it by Google or an emailed code, and goes on once signed in", async () => {
    const gate = {
      required: true, signedIn: false,
      state: vi.fn(async () => ({ required: gate.required, blocked: !gate.signedIn, status: gate.signedIn ? "connected" : "signed-out" })),
      options: vi.fn(async () => ({ providers: ["google"], recovery: true })),
      signInStart: vi.fn(async (email: string) => ({ outcome: "sent", email, expiresAt: Date.now() + 600_000, resendAt: Date.now() + 30_000, signupOpen: true })),
      signInVerify: vi.fn(async () => { gate.signedIn = true; return { outcome: "signed-in" }; }),
      signInCancel: vi.fn(async () => {}), browser: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})), reopen: vi.fn(), onChange: () => () => {},
    };
    desktop({ accountGate: gate });
    await show();
    expect(step(), "where bots live comes first").toBe("place");
    await choose("[data-funnel-place=mac]");
    expect(step()).toBe("account");
    expect(title()).toBe("Sign in to dusk bot");
    expect(text(), "no phone in the pitch while its app is hidden").toContain("Your account keeps dusk cloud and your bots in sync.");
    expect(button("Continue with Google")).toBeDefined();
    expect(button("Continue without an account"), "required here").toBeUndefined();
    await type(document.body.querySelector<HTMLInputElement>("input[type=email]")!, "person@example.com");
    await press("Email me a code");
    expect(gate.signInStart).toHaveBeenCalledWith("person@example.com");
    const digits = [...document.body.querySelectorAll<HTMLInputElement>("input")];
    for (const [index, digit] of digits.entries()) await type(digit, String(index + 1));
    await press("Sign in");
    expect(gate.signInVerify).toHaveBeenCalledWith("12345678");
    expect(step()).toBe("ai");
  });

  it("never offers to go on without an account where the app needs one", async () => {
    desktop({ accountGate: { state: async () => ({ required: true, blocked: true, status: "signed-out" }), options: async () => ({ providers: [], recovery: false }), onChange: () => () => {} } });
    await show();
    await choose("[data-funnel-place=mac]");
    expect(step()).toBe("account");
    expect(button("Continue without an account")).toBeUndefined();
    await key("Escape");
    expect(step()).toBe("account");
  });

});

describe("Dusk as the Chief", () => {
  it("makes Dusk the Chief only where there is none", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }] };
    await show();
    await press("Get started");
    await usesFoundAi();
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true, chiefOfStaff: true } });
  });

  it("lands on no bot where another bot is already the Chief", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }, { ...maus, id: "research", threadId: "r", name: "Research", defaultBot: undefined, chiefOfStaff: true }] };
    await show();
    await press("Get started");
    await usesFoundAi();
    expect(f.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateBot" }));
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe("other first runs", () => {
  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true });
    await press("Get started");
    await usesFoundAi();
    await act(async () => {});
    expect(f.onDone).toHaveBeenCalledOnce();
    expect(saved()[0].onboarding).not.toHaveProperty("hintsSeen");
    expect(introStaged("maus"), "a replay lands in a chat that may be long under way").toBe(false);
  });
});

describe("bots from another app on this computer", () => {
  const found = { apps: [{ source: "openclaw", app: "OpenClaw", where: "~/.openclaw", channels: ["telegram"], unreadable: [], bots: [{
    name: "Molty", title: "", description: "", instructions: "Be helpful.", memories: ["Sam's sister is Ana."], userFacts: [],
    skills: [{ name: "groceries", description: "Lists.", instructions: "---\nname: groceries\ndescription: Lists.\n---\n\nWrite the list." }],
    routines: [{ name: "Morning", instruction: "Brief me.", trigger: "schedule", cron: "0 8 * * *", when: "", timeZone: "UTC", paused: false, skills: [], details: "" }],
    apps: [],
  }] }] };
  const desktop = (bots: unknown, setup: unknown = { skills: [], tools: [] }) => {
    vi.stubGlobal("duskDesktop", { remoteClient: { active: false } });
    const base = f.api.getMockImplementation()!;
    f.api.mockImplementation(async (path: string, init?: { body?: string; method?: string }) => {
      if (path === "/api/setup-import/bots") return bots;
      if (path === "/api/setup-import") return init?.method === "POST"
        ? { skills: { added: ["pdf"], present: [], skipped: [], filesLeftOut: 0, review: [] }, tools: { added: [], present: [], skipped: [] }, instructions: [] }
        : setup;
      if (path === "/api/mcp/servers") return { servers: [] };
      if (path.startsWith("/api/teams/import")) return { bots: [{ ...maus, id: "molty", name: JSON.parse(init!.body!).package.name, defaultBot: undefined }], routines: [] };
      return base(path, init);
    });
  };

  it("lists what this Mac holds, all chosen, and brings it in on one press while the run goes on to the chat", async () => {
    desktop(found, { skills: [{ name: "pdf", source: "claudeCode" }], tools: [{ name: "notion", source: "cursor" }] });
    await show({ initialBeat: "bring" });
    expect(title()).toBe("Bring what you already use");
    expect(text()).toContain("Molty");
    expect([...document.body.querySelectorAll("[data-bring-find]")].map((row) => [row.getAttribute("data-bring-find"), row.getAttribute("aria-checked")]))
      .toEqual([["bots:openclaw", "true"]]);
    // a skill or an MCP server alone is no row: it comes in with the rest
    expect(text()).not.toContain("Cursor");
    const online = document.body.querySelector<HTMLButtonElement>("[data-bring-online]")!;
    expect(online.getAttribute("aria-expanded"), "the prompt for AIs online waits behind one quiet line").toBe("false");
    await act(async () => { online.click(); });
    expect(online.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.querySelector("[data-bring-prompt] [style*=background]"), "the steps' numbers are tonal, not coloured").toBeNull();
    expect(document.body.querySelector("[data-bring-scene]")?.getAttribute("data-bring-scene"), "nothing travels before anything is brought").toBe("still");
    await press("Bring it in");
    expect(button("Continue"), "the way on is there at once, without waiting").toBeTruthy();
    expect(button("Bring it in")).toBeUndefined();
    await settle();
    const applied = f.api.mock.calls.filter(([path, init]) => path === "/api/setup-import" && init?.method === "POST").map(([, init]) => JSON.parse(init.body));
    expect(applied).toEqual([{ skills: true, tools: true, instructions: true, sources: ["claudeCode", "cursor"] }]);
    expect(f.api.mock.calls.filter(([path]) => String(path).startsWith("/api/teams/import"))).toHaveLength(1);
    expect(document.body.querySelector("[data-bring-run]")?.textContent, "what came in, said on the step itself").toBe("Brought in 1 bot and 1 skill.");
    expect(document.body.querySelector("[data-bring-find]")?.getAttribute("aria-disabled"), "what was brought is no longer a choice").toBe("true");
    expect(document.body.querySelector("[data-bring-status]"), "and not twice").toBeNull();
    expect(document.body.querySelector("[data-bring-scene]")?.getAttribute("data-bring-scene"), "nothing travels once it's done").toBe("still");
    await press("Continue");
    expect(f.onDone).toHaveBeenCalledOnce();
  });

  it("with nothing on this Mac, offers the prompt for an AI online: copy, then go on without waiting", async () => {
    desktop({ apps: [] });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await show({ initialBeat: "bring" });
    expect(step()).toBe("bring");
    expect(document.body.querySelector("[data-bring-find]")).toBeNull();
    expect(document.body.querySelector("[data-bring-prompt] pre")?.textContent, "the prompt itself, read-only, to look over first").toContain("dusk-bot-notes");
    expect(button("Continue"), "continue is the main action before and after the copy").toBeTruthy();
    await press("Copy the prompt");
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("dusk-bot-notes"));
    expect(document.body.querySelector("[data-bring-copied]")?.textContent).toContain("Copied.");
    expect(JSON.parse(localStorage.getItem("dusk.notesWaiting")!)).toHaveProperty("since");
    await press("Continue");
    expect(f.onDone).toHaveBeenCalledOnce();
  });
});
