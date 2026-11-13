// @vitest-environment happy-dom
// The first run as a funnel: the welcome (with the help-improve switch), a dusk bot account, where the bots live, an AI,
// bots from another app when there are some, the phone, then Dusk's chat; on dusk cloud, the Cloud being made. What each
// step shows, where it goes, and what it saves.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import type { InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), onDone: vi.fn(),
  improve: [] as unknown[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn() }), api: f.api }));
vi.mock("@/state/api", () => ({ api: f.api }));
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
const text = () => host.textContent ?? "";
const step = () => host.querySelector<HTMLElement>("[data-welcome]")?.dataset.welcome;
const title = () => host.querySelector("#welcome-title")?.textContent;
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no "${label}" button on ${step()}: ${text()}`);
  await act(async () => { target.click(); });
  await settle();
};
const choose = async (selector: string) => {
  await act(async () => { host.querySelector<HTMLElement>(selector)!.click(); });
  await settle();
};
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); };
const key = async (name: string) => {
  await act(async () => { host.querySelector<HTMLElement>("[data-welcome]")!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  await settle();
};
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, ...extra })); });
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
  vi.useRealTimers();
});

describe("the welcome", () => {
  it("opens on the welcome, with the help-improve switch on and saved when switched", async () => {
    await show();
    expect(step()).toBe("welcome");
    expect(title()).toBe("meet dusk bot");
    const line = host.querySelector<HTMLElement>("[data-help-improve]")!;
    expect(line.className).toContain("text-[12px]");
    const toggle = line.querySelector<HTMLButtonElement>("[role=switch]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => { toggle.click(); });
    await settle();
    expect(f.improve).toEqual([{ enabled: false }]);
    expect(f.onDone).not.toHaveBeenCalled();
    expect(host.querySelector("textarea"), "nothing asks for a job").toBeNull();
  });

  it("with Claude already answering, still shows the AI step with Claude connected, one press from Dusk's chat", async () => {
    await show();
    await press("get started");
    expect(step()).toBe("ai");
    expect(host.querySelector("[data-funnel-ai=claude]")?.hasAttribute("data-connected")).toBe(true);
    await press("continue");
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
    await press("get started");
    expect(step()).toBe("ai");
    expect(title()).toBe("connect an AI");
    expect([...host.querySelectorAll<HTMLElement>("[data-funnel-ai]")].map((tile) => tile.dataset.funnelAi)).toEqual(["chatgpt", "claude", "cursor", "copilot", "more"]);
    expect(text()).toContain("ChatGPT");
    await press("Claude");
    expect(host.querySelector("[data-funnel-ai-connect=claude]")).not.toBeNull();
    expect(button("sign in with Claude")).toBeDefined();
    await press("more ways");
    expect(host.querySelector("[data-connect-ai]")).not.toBeNull();
  });

  it("shows connected AIs as connected, not to be pressed again, with continue ready and more still to add", async () => {
    f.state = { ...f.state, instances: nothingSignedIn() };
    await show();
    await press("get started");
    expect(button("continue"), "nothing connected yet: only the quiet way on").toBeUndefined();
    expect(button("set up later")?.className).not.toContain("ui-button-primary");
    const focus = vi.fn(async () => true);
    vi.stubGlobal("duskDesktop", { focusWindow: focus });
    f.state = { ...f.state, instances: [cursor(true), { ...claude(true), instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" } as InstanceInfo, signedOut("claude", "claudeAgent", "Claude")] };
    await show();
    expect(title()).toBe("connect an AI");
    const connected = [...host.querySelectorAll<HTMLElement>("[data-funnel-ai][data-connected]")].map((tile) => tile.dataset.funnelAi);
    expect(connected).toEqual(["chatgpt", "cursor"]);
    expect(host.querySelector("[data-funnel-ai=cursor]")?.tagName, "a connected AI is not a button").toBe("DIV");
    expect(host.querySelector("[data-funnel-ai=cursor]")?.textContent).toContain("connected");
    expect(focus, "a sign-in that finished brings the app back").toHaveBeenCalled();
    expect(button("set up later")).toBeUndefined();
    expect(button("continue")?.className).toContain("ui-button-primary");
    expect(host.querySelector("button[data-funnel-ai=claude]"), "another can still be added").not.toBeNull();
    await press("continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });

  it("set up later, or the free model, goes on; a found sign-in that didn't answer says why", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, ...nothingSignedIn()] };
    await show();
    await press("get started");
    expect(button("start with the free model")).toBeDefined();
    await press("set up later");
    expect(f.onDone).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = createRoot(host);
    f.onDone.mockReset();
    f.state = { ...f.state, instances: [claude(true, "failed")] };
    await show({ initialBeat: "ai" });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Claude");
  });
});

describe("on the desktop app", () => {
  const desktop = (extra: Record<string, unknown> = {}) => vi.stubGlobal("duskDesktop", { remoteClient: { active: false }, requireUserPresence: async () => true, ...extra });

  it("walks where bots live, the AI, the phone, then the chat, with back and progress, and no email step", async () => {
    desktop();
    await show();
    await press("get started");
    expect(step()).toBe("place");
    expect(host.querySelector("[data-funnel-progress]")?.getAttribute("data-funnel-progress")).toBe("2/4");
    expect(text()).toContain("this Mac");
    expect(text()).toContain("dusk cloud");
    expect(text()).toContain("from $20 a month");
    await choose("[data-funnel-place=mac]");
    expect(step()).toBe("ai");
    await press("continue");
    expect(step()).toBe("phone");
    expect(host.querySelector(".phone-frame img"), "the phone app's own screen").not.toBeNull();
    expect(button("skip")?.className, "skip is a real button").toContain("ui-button-lg");
    await press("back");
    expect(step()).toBe("ai");
    await press("continue");
    await press("show the code");
    expect(host.querySelector("[data-phone-offer]")).not.toBeNull();
    await press("continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });

  it("a double click on get started does not also choose where bots live", async () => {
    desktop();
    await show();
    await press("get started");
    const second = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 });
    await act(async () => { host.querySelector<HTMLElement>("[data-funnel-place=mac]")!.dispatchEvent(second); });
    await settle();
    expect(step()).toBe("place");
    await choose("[data-funnel-place=mac]");
    expect(step()).toBe("ai");
  });

  it("stays on where bots live when dusk cloud's sheet closes unpaid", async () => {
    desktop({ cloudAccount: { state: async () => ({ status: "connected", clouds: [] }), onState: () => () => {} } });
    await show({ initialBeat: "place" });
    await choose("[data-funnel-place=cloud]");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "openCloudAdd", source: "app_onboarding" });
    f.state = { ...f.state, cloudAdd: { source: "app_onboarding" } };
    await show({ initialBeat: "place" });
    f.state = { ...f.state, cloudAdd: null };
    await show({ initialBeat: "place" });
    expect(step()).toBe("place");
  });

  it("on dusk cloud: pay, connect an AI, then the Cloud being made, its sign-ins held, and its chat once ready", async () => {
    const own = (status: string, extra: Record<string, unknown> = {}) => ({ status: "connected", clouds: [{ id: "c1", primary: true, runsOn: "cloud", status, origin: status === "ready" ? "https://c1.dusk.test" : null, ...extra }] });
    let listener: ((next: unknown) => void) | null = null;
    const cloudAccount = {
      now: own("setting_up", { setup: { step: "storage", progress: 0.4 } }) as unknown,
      state: vi.fn(async () => cloudAccount.now), refresh: vi.fn(async () => cloudAccount.now),
      onState: (cb: (next: unknown) => void) => { listener = cb; return () => {}; },
      holdSignIns: vi.fn(async () => ({ outcome: "held" })), connectHome: vi.fn(async () => ({ status: "connected" })),
    };
    desktop({ cloudAccount });
    await show({ initialBeat: "place" });
    await choose("[data-funnel-place=cloud]");
    f.state = { ...f.state, cloudAdd: { source: "app_onboarding" } };
    await show({ initialBeat: "place" });
    f.state = { ...f.state, cloudAdd: null };
    await show({ initialBeat: "place" });
    expect(step(), "paid: the AI comes next").toBe("ai");
    expect(host.querySelector("[data-funnel-progress]")?.getAttribute("data-funnel-progress"), "welcome, place, ai, making").toBe("3/4");
    await press("continue");
    expect(step()).toBe("making");
    expect(title()).toBe("making your cloud");
    expect(host.querySelector("[data-funnel-making]")?.getAttribute("data-funnel-making")).toBe("setting-up");
    expect(host.querySelector("[aria-current=step]")?.textContent).toBe("preparing storage");
    expect(cloudAccount.holdSignIns).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("dusk.onboarding.welcomeDraft")!), "a closed app comes back here").toMatchObject({ beat: "making", cloud: true });
    await act(async () => { listener?.(own("ready")); });
    await settle();
    expect(cloudAccount.connectHome).toHaveBeenCalledOnce();
    expect(f.onDone).toHaveBeenCalledOnce();
  });

  it("asks for a dusk bot account by Google or an emailed code, and goes on once signed in", async () => {
    const gate = {
      required: false, signedIn: false,
      state: vi.fn(async () => ({ required: gate.required, blocked: false, status: gate.signedIn ? "connected" : "signed-out" })),
      options: vi.fn(async () => ({ providers: ["google"], recovery: true })),
      signInStart: vi.fn(async (email: string) => ({ outcome: "sent", email, expiresAt: Date.now() + 600_000, resendAt: Date.now() + 30_000, signupOpen: true })),
      signInVerify: vi.fn(async () => { gate.signedIn = true; return { outcome: "signed-in" }; }),
      signInCancel: vi.fn(async () => {}), browser: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})), reopen: vi.fn(), onChange: () => () => {},
    };
    desktop({ accountGate: gate });
    await show();
    await press("get started");
    expect(step()).toBe("account");
    expect(title()).toBe("sign in to dusk bot");
    expect(button("continue with Google")).toBeDefined();
    expect(button("continue without an account")).toBeDefined();
    await type(host.querySelector<HTMLInputElement>("input[type=email]")!, "person@example.com");
    await press("email me a code");
    expect(gate.signInStart).toHaveBeenCalledWith("person@example.com");
    const digits = [...host.querySelectorAll<HTMLInputElement>("input")];
    for (const [index, digit] of digits.entries()) await type(digit, String(index + 1));
    await press("sign in");
    expect(gate.signInVerify).toHaveBeenCalledWith("12345678");
    expect(step()).toBe("place");
  });

  it("never offers to go on without an account where the app needs one", async () => {
    desktop({ accountGate: { state: async () => ({ required: true, blocked: true, status: "signed-out" }), options: async () => ({ providers: [], recovery: false }), onChange: () => () => {} } });
    await show({ initialBeat: "account" });
    expect(step()).toBe("account");
    expect(button("continue without an account")).toBeUndefined();
    await key("Escape");
    expect(step()).toBe("account");
  });
});

describe("Dusk as the Chief", () => {
  it("makes Dusk the Chief only where there is none", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }] };
    await show();
    await press("get started");
    await press("continue");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true, chiefOfStaff: true } });
  });

  it("lands on no bot where another bot is already the Chief", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }, { ...maus, id: "research", threadId: "r", name: "Research", defaultBot: undefined, chiefOfStaff: true }] };
    await show();
    await press("get started");
    await press("continue");
    expect(f.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateBot" }));
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe("other first runs", () => {
  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true });
    await press("get started");
    await press("continue");
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
  const desktop = (bots: unknown) => {
    vi.stubGlobal("duskDesktop", { remoteClient: { active: false } });
    const base = f.api.getMockImplementation()!;
    f.api.mockImplementation(async (path: string, init?: { body?: string }) => {
      if (path === "/api/setup-import/bots") return bots;
      if (path === "/api/mcp/servers") return { servers: [] };
      if (path.startsWith("/api/teams/import")) return { bots: [{ ...maus, id: "molty", name: JSON.parse(init!.body!).package.name, defaultBot: undefined }], routines: [] };
      return base(path, init);
    });
  };

  it("offers them on the bring step, moves them on one press, and goes on to the phone", async () => {
    desktop(found);
    await show({ initialBeat: "bring" });
    expect(host.querySelector("#bot-move-title")?.textContent).toBe("bring your bots from OpenClaw?");
    expect(text()).toContain("Molty");
    await press("bring them over");
    expect(f.api.mock.calls.filter(([path]) => String(path).startsWith("/api/teams/import"))).toHaveLength(1);
    expect(host.querySelector("#bot-move-title")?.textContent).toBe("your bots are here");
    await press("continue");
    expect(step()).toBe("phone");
  });

  it("has no step at all when no other app is here", async () => {
    desktop({ apps: [] });
    await show({ initialBeat: "bring" });
    expect(host.querySelector("#bot-move-title")).toBeNull();
    expect(step()).toBe("phone");
  });
});
