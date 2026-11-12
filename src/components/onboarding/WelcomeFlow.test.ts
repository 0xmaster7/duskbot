// @vitest-environment happy-dom
// The first run: one screen asking for a first job, then the chat with that job already sent. The AI it runs on (a found
// sign-in, the free backup, or one sign-in), what it saves, where it lands (Dusk, made the Chief where none is), and what a
// replay does.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import type { InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), onDone: vi.fn(),
  checks: [] as string[], tour: vi.fn(async () => {}) }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn() }));
vi.mock("./IslandIntroHost", () => ({ openIslandIntro: f.tour }));
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
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", install: { docsUrl: "https://example.test" },
  snapshot: { state: ready ? "available" : "unavailable", authenticated: ready }, models: { default: "m", options: [] }, ...(aiTest ? { aiTest } : {}),
});
const freeOpenCode: InstanceInfo = {
  instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", install: { docsUrl: "https://example.test" },
  snapshot: { state: "available", authenticated: true, freeFallback: true }, models: { default: "opencode/big-pickle", options: [] }, aiTest: "passed",
};
const signIn = (): InstanceInfo => ({ ...claude(false), snapshot: { state: "available", authenticated: false }, authentication: { method: "paste-code" } } as InstanceInfo);
const maus = { id: "maus", threadId: "t", name: "Dusk", title: "", description: "", notifications: true, color: "chrome", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], defaultBot: {}, chiefOfStaff: true };

let host: HTMLDivElement, root: Root;
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
const press = async (label: string) => { await act(async () => { button(label)!.click(); }); };
const composer = () => host.querySelector<HTMLTextAreaElement>("[data-start-composer] textarea")!;
const type = async (value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(composer(), value);
    composer().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = async (name: string, target: HTMLElement = host.querySelector<HTMLElement>("[data-welcome]")!) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
};
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, ...extra })); });
};
const sent = () => f.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "send");
const saved = () => f.api.mock.calls.filter(([path, init]) => path === "/api/config" && init?.method === "PUT").map(([, init]) => JSON.parse(init.body));
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, String(v)), removeItem: (k: string) => void values.delete(k), clear: () => values.clear() };
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
  f.tour.mockClear();
  f.checks = [];
  f.api.mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path.endsWith("/check")) { f.checks.push(path); return { ok: true }; }
    return path === "/api/instances" ? { instances: f.state.instances } : JSON.parse(init?.body ?? "{}");
  });
  f.state = { instances: [claude(true)], config: { onboarding: EMPTY_ONBOARDING, profile: { name: "" } }, bots: [maus], cloudAdd: null };
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

describe("a new install's first run", () => {
  it("is one screen: a job picked and started lands in Dusk's chat with the job already sent", async () => {
    await show();
    expect(host.querySelector("h1")?.textContent).toBe("What should Dusk take off your plate?");
    for (const gone of ["Next", "Back", "How should your Bots talk?", "Give each Bot a job"]) expect(text()).not.toContain(gone);
    expect([...host.querySelectorAll("[data-job]")].map((chip) => chip.textContent)).toEqual(["Summarize my inbox", "Watch a price", "Plan a trip", "Research a topic"]);
    expect(button("Start")!.disabled, "nothing to start until there is a job").toBe(true);

    await press("Watch a price");
    expect(composer().value).toContain("AirPods Pro");
    expect(composer().value.slice(composer().selectionStart, composer().selectionEnd), "the example is selected to type over").toBe("AirPods Pro");
    expect(host.querySelector("[data-job=price]")?.getAttribute("aria-pressed")).toBe("true");
    await press("Start");

    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true, outbound: { policy: "ask", dailyCap: 25 } } });
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(sent()).toEqual([expect.objectContaining({ botId: "maus", text: expect.stringContaining("AirPods Pro"), sendId: expect.any(String) })]);
    expect(introStaged("maus"), "the job is the first thing in the chat, not a staged greeting").toBe(false);
    await act(async () => {});
    expect(saved()).toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT] }) }]);
  });

  it("starts a job written by hand with Enter, and Shift+Enter keeps writing", async () => {
    await show();
    await type("Find me a dentist near work");
    await key("Enter", composer());
    expect(sent()).toEqual([expect.objectContaining({ botId: "maus", text: "Find me a dentist near work" })]);
  });

  it("uses a sign-in it found once that answered one tiny test message, and says so in one line", async () => {
    await show();
    expect(f.checks).toEqual(["/api/instances/claude/check"]);
    await act(async () => {});
    expect(host.querySelector("[data-ai-line=ready]")?.textContent).toContain("Using your Claude account");
    expect(host.querySelector("[data-sign-in]")).toBeNull();
  });

  it("says in plain words what Dusk asks about before it does it", async () => {
    await show();
    expect(host.querySelector("[data-safe-line]")?.textContent).toBe("Dusk reads, searches and drafts on its own. It asks you before it sends, posts or pays for anything.");
  });

  it("keeps a sending rule the person already chose", async () => {
    f.state = { ...f.state, bots: [{ ...maus, outbound: { policy: "allow", dailyCap: 3 } }] };
    await show();
    await type("Plan my week");
    await press("Start");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
  });
});

describe("Skip", () => {
  it("lands in Dusk's chat with nothing sent, its greeting staged", async () => {
    await show();
    await press("Skip for now");
    expect(sent()).toEqual([]);
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus")).toBe(true);
  });

  it("is what Escape does, but never while a job is being written", async () => {
    await show();
    await type("Half a thought");
    await key("Escape", composer());
    expect(f.onDone).not.toHaveBeenCalled();
    await type("");
    await key("Escape", composer());
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });
});

describe("Dusk as the Chief", () => {
  it("makes Dusk the Chief only where there is none", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }] };
    await show();
    await press("Skip for now");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true, chiefOfStaff: true } });
  });

  it("still sends the job to Dusk once Dusk has met the person, with nothing else changed", async () => {
    f.state = { ...f.state, bots: [{ ...maus, welcomed: true }] };
    await show();
    await press("Plan a trip");
    await press("Start");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { outbound: { policy: "ask", dailyCap: 25 } } });
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(sent()).toHaveLength(1);
  });

  it("skips to no bot where another bot is already the Chief", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }, { ...maus, id: "research", threadId: "r", name: "Research", defaultBot: undefined, chiefOfStaff: true }] };
    await show();
    await press("Skip for now");
    expect(f.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateBot" }));
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("sends a job to the first bot where there is no Dusk", async () => {
    const other = { ...maus, id: "ada", threadId: "a", name: "Ada", defaultBot: undefined, chiefOfStaff: false };
    f.state = { ...f.state, bots: [other] };
    await show();
    await type("Research flights");
    await press("Start");
    expect(sent()).toEqual([expect.objectContaining({ botId: "ada" })]);
  });
});

describe("with no AI of the person's own", () => {
  it("runs jobs on the free backup, says so, and keeps one tap to sign in", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, signIn()] };
    await show();
    expect(host.querySelector("[data-ai-line=free]")?.textContent).toContain("Running on a free model for now.");
    expect(button("Use your Claude account")).toBeDefined();
    await type("Research standing desks");
    expect(button("Start")!.disabled, "the free model never blocks a job").toBe(false);
    await press("Start");
    expect(sent()).toHaveLength(1);
  });

  it("asks for one sign-in only when nothing at all can run a job, with every other way one click off", async () => {
    f.state = { ...f.state, instances: [signIn()] };
    await show();
    expect(host.querySelector("[data-ai-line=connect]")).not.toBeNull();
    expect(button("Sign in with Claude")).toBeDefined();
    await press("Plan a trip");
    expect(button("Start")!.disabled).toBe(true);
    await press("Other ways to connect");
    expect(host.querySelector("[data-connect-ai]")?.textContent).toContain("Connect an AI");
    await act(async () => { host.querySelector("[data-connect-ai]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("[data-connect-ai]")).toBeNull();
    expect(f.onDone, "Escape closed the dialog only").not.toHaveBeenCalled();
  });

  it("says why a found sign-in didn't answer, and falls back to the free model", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, claude(true, "failed")] };
    await show();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Claude");
    expect(host.querySelector("[data-ai-line=free]")).not.toBeNull();
  });

  it("switches the line to the found account once it connects", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, signIn()] };
    await show();
    f.state = { ...f.state, instances: [freeOpenCode, claude(true)] };
    await show();
    await act(async () => {});
    expect(host.querySelector("[data-ai-line=ready]")?.textContent).toContain("Using your Claude account");
  });
});

describe("optional moments", () => {
  it("offers the notch tour where the app has the island, and plays it without leaving the screen", async () => {
    vi.stubGlobal("duskDesktop", { ambient: { prefs: async () => ({ available: true, island: false, dock: true }), set: vi.fn() } });
    await show();
    await act(async () => {});
    await press("See where your bots live");
    expect(f.tour).toHaveBeenCalledOnce();
    expect(f.onDone).not.toHaveBeenCalled();
  });

  it("offers neither the tour nor the cloud where the app has no island or cloud account", async () => {
    await show();
    expect(button("See where your bots live")).toBeUndefined();
    expect(button("Keep it running in the cloud")).toBeUndefined();
  });

  it("opens the cloud desktop sheet over the screen from the desktop app", async () => {
    vi.stubGlobal("duskDesktop", { remoteClient: { active: false }, cloudAccount: {} });
    await show();
    await press("Keep it running in the cloud");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "openCloudAdd", source: "app_onboarding" });
    expect(f.onDone).not.toHaveBeenCalled();
  });
});

describe("other first runs", () => {
  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true });
    await press("Skip for now");
    await act(async () => {});
    expect(saved()[0].onboarding).not.toHaveProperty("hintsSeen");
    expect(introStaged("maus"), "a replay lands in a chat that may be long under way").toBe(false);
  });
});
