// @vitest-environment happy-dom
// The first run lands in Dusk's chat, where Dusk greets and asks for what is missing. Only bots from another app and a
// sign-in when nothing at all can answer come before it. Where it lands (Dusk, made the Chief where none is), what it
// saves, and what a replay does.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import type { InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), onDone: vi.fn(),
  checks: [] as string[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/components/mascot-clock", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/EngineSetup", async (original) => {
  const { createElement: h } = await import("react");
  return { ...(await original<typeof import("@/components/EngineSetup")>()),
    EngineSetup: ({ instance }: { instance: InstanceInfo }) => h("div", { "data-engine-setup": instance.instanceId }) };
});
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
const { AI_WAIT_MS, WelcomeFlow } = await import("./WelcomeFlow");

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
const key = async (name: string, target: HTMLElement = host.querySelector<HTMLElement>("[data-welcome]")!) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
};
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, ...extra })); });
};
const sent = () => f.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "send");
const asked = () => host.querySelector("[data-sign-in-step]");
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
  f.checks = [];
  f.api.mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path.endsWith("/check")) { f.checks.push(path); return { ok: true }; }
    return path === "/api/instances" ? { instances: f.state.instances } : JSON.parse(init?.body ?? "{}");
  });
  f.state = { hydrated: true, instances: [claude(true)], config: { onboarding: EMPTY_ONBOARDING, profile: { name: "" } }, bots: [maus], cloudAdd: null };
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
  it("goes straight to Dusk's chat with its greeting staged: no screen, nothing sent", async () => {
    await show();
    expect(asked()).toBeNull();
    expect(host.querySelector("textarea"), "nothing asks for a job").toBeNull();
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus")).toBe(true);
    expect(sent()).toEqual([]);
    await act(async () => {});
    expect(saved()).toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT] }) }]);
  });

  it("waits for the bots and the AIs to be listed, and goes on without them after a while", async () => {
    f.state = { ...f.state, hydrated: undefined, instances: [] };
    await show();
    expect(f.onDone).not.toHaveBeenCalled();
    expect(host.querySelector("[data-welcome-looking]")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(AI_WAIT_MS); });
    expect(f.onDone).toHaveBeenCalledOnce();
  });

  it("goes to the chat on the free backup, where signing in is Dusk's to ask", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, signIn()] };
    await show();
    expect(asked()).toBeNull();
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });
});

describe("Dusk as the Chief", () => {
  it("makes Dusk the Chief only where there is none", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }] };
    await show();
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true, chiefOfStaff: true } });
  });

  it("lands on no bot where another bot is already the Chief", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }, { ...maus, id: "research", threadId: "r", name: "Research", defaultBot: undefined, chiefOfStaff: true }] };
    await show();
    expect(f.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateBot" }));
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe("when nothing at all can answer", () => {
  it("asks for one sign-in, in small words, with every other way one click off", async () => {
    f.state = { ...f.state, instances: [signIn()] };
    await show();
    expect(asked()).not.toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Connect an AI and Dusk can start.");
    expect(button("sign in with Claude")).toBeDefined();
    expect(f.onDone).not.toHaveBeenCalled();
    await press("other ways to connect");
    expect(host.querySelector("[data-connect-ai]")?.textContent).toContain("connect an AI");
    await act(async () => { host.querySelector("[data-connect-ai]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("[data-connect-ai]")).toBeNull();
    expect(f.onDone, "Escape closed the dialog only").not.toHaveBeenCalled();
  });

  it("goes on to the chat once an AI is signed in", async () => {
    f.state = { ...f.state, instances: [signIn()] };
    await show();
    f.state = { ...f.state, instances: [claude(true)] };
    await show();
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus")).toBe(true);
  });

  it("set up later, or Escape, goes to the chat, where Dusk asks again", async () => {
    f.state = { ...f.state, instances: [signIn()] };
    await show();
    await press("set up later");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    await act(async () => root.unmount());
    root = createRoot(host);
    f.onDone.mockReset();
    await show();
    await key("Escape");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });

  it("says why a found sign-in didn't answer", async () => {
    f.state = { ...f.state, instances: [claude(true, "failed")] };
    await show();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Claude");
  });
});

describe("other first runs", () => {
  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true });
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
    f.api.mockImplementation(async (path: string, init?: { body?: string }) => {
      if (path === "/api/setup-import/bots") {
        if (bots === "fail") throw new Error("down");
        return bots;
      }
      if (path === "/api/setup-import/grok") return { files: [], bots: [] };
      if (path === "/api/mcp/servers") return { servers: [] };
      if (path.startsWith("/api/teams/import")) return { bots: [{ ...maus, id: "molty", name: JSON.parse(init!.body!).package.name, defaultBot: undefined }], routines: [] };
      return path === "/api/instances" ? { instances: f.state.instances } : JSON.parse(init?.body ?? "{}");
    });
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); };

  it("offers them before the chat, moves them on one press, and says what came over and what stayed", async () => {
    desktop(found);
    await show();
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("bring your bots from OpenClaw?");
    expect(text()).toContain("Molty");
    expect(text()).toContain("1 bot, 1 skill, 1 routine and their memory");
    await press("bring them over");
    await settle();
    expect(f.api.mock.calls.filter(([path]) => String(path).startsWith("/api/teams/import"))).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("your bots are here");
    expect(text()).toContain("moved 1 bot, 1 skill, 1 routine and their memory.");
    expect(host.querySelector("[data-bot-move-left-out]")?.textContent).toContain("Chat history, logins and their Telegram connections stay in OpenClaw.");
    expect(f.onDone).not.toHaveBeenCalled();
    await press("continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });

  it("skip, or Escape, goes on to the chat with nothing moved", async () => {
    desktop(found);
    await show();
    await settle();
    expect(f.onDone).not.toHaveBeenCalled();
    await key("Escape");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(f.api.mock.calls.some(([path]) => String(path).startsWith("/api/teams/import"))).toBe(false);
  });

  it("says nothing when no other app is here, or when the look fails", async () => {
    desktop({ apps: [] });
    await show();
    await settle();
    expect(host.querySelector("#bot-move-title")).toBeNull();
    expect(f.onDone).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = createRoot(host);
    f.onDone.mockReset();
    desktop("fail");
    await show();
    await settle();
    expect(host.querySelector("#bot-move-title")).toBeNull();
    expect(f.onDone).toHaveBeenCalledOnce();
  });

  it("is never offered on a replay or outside the desktop app", async () => {
    desktop(found);
    await show({ replay: true });
    await settle();
    expect(host.querySelector("#bot-move-title")).toBeNull();
    expect(f.api.mock.calls.some(([path]) => path === "/api/setup-import/bots")).toBe(false);
  });
});
