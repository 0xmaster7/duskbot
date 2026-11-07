// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({
  container: "missing" as string,
  configured: true,
  imageMatches: true,
  posts: [] as string[],
  looks: 0,
  advanced: true,
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined }),
  useDesktopCapabilities: () => ({
    ready: true,
    capabilities: {
      host: { platform: "darwin", label: "Host", session: "unknown", packaged: true, homeDir: "/Users/me" },
      windowChrome: "native",
      screenPreview: { available: false, interaction: "none" },
      dictation: { available: false, engine: "none", onDevice: false },
      localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
    },
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
// The owner: starting a cloud computer early is an Admin's shortcut.
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./CloudScreenPreview", () => ({
  CloudScreenPreview: () => createElement("div", { "data-live-screen": "" }),
}));
vi.mock("./BrowserPanel", () => ({ BrowserPanel: () => null }));
vi.mock("./LiveDesktop", () => ({ LiveDesktop: () => createElement("div", { "data-live-screen": "" }) }));
vi.mock("./bot-settings/RoutinesSection", () => ({ RoutinesSection: () => null }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") fixture.posts.push(path.split("?")[0]!);
    if (path.startsWith("/api/bots/scout/computer/provision")) {
      fixture.container = "running";
      return { ready: true, container: "running" };
    }
    if (path.startsWith("/api/bots/scout/computer/screenshot")) return { png: "FRAME", format: "jpeg" };
    if (path.startsWith("/api/bots/scout/computer/control")) return { held: false, helpReason: null };
    if (path.startsWith("/api/bots/scout/computer?")) {
      fixture.looks++;
      return { surface: "cloud", backend: "vps", configured: fixture.configured, ready: fixture.container === "running" && fixture.imageMatches,
        container: fixture.container, managed: fixture.container !== "missing", imageMatches: fixture.imageMatches, problem: "Fixture desktop is not running" };
    }
    return {};
  },
}));

const { ComputerPanel } = await import("./ComputerPanel");
const { BotEditorStore, initialState } = await import("@/state/store");

const engine = {
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription",
  snapshot: { state: "available", version: "1", authenticated: true },
  models: { default: "m", options: [{ id: "m", label: "M" }] },
  capabilities: { computerMcp: true, browserMcp: true },
} as InstanceInfo;
const makeBot = (patch: Partial<Bot> = {}): Bot => ({
  id: "scout", threadId: "thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "claude", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
  ...patch,
}) as unknown as Bot;

let root: Root | null = null;
const value = (): Parameters<typeof BotEditorStore>[0]["value"] => ({
  state: { ...initialState, instances: [engine], config: { vps: { configured: true } } as AppState["config"] } as AppState,
  dispatch: vi.fn(),
  flushBotPatches: async () => null,
  refreshInstances: async () => {},
  refreshModels: async () => {},
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const open = async (bot: Bot) => {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  flushSync(() => root!.render(createElement(BotEditorStore, { value: value(), children: createElement(ComputerPanel, { bot }) })));
  await settle();
};
const text = () => document.body.textContent ?? "";
const spinning = () => document.querySelector(".animate-spin") !== null;

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  vi.stubGlobal("ogb", undefined);
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  fixture.posts.length = 0;
  fixture.container = "missing";
  fixture.configured = true;
  fixture.imageMatches = true;
  fixture.looks = 0;
  fixture.advanced = true;
  vi.useRealTimers();
});

describe("VPS computer preparation", () => {
  it("does not create a missing computer just because an Auto screen panel opens", async () => {
    await open(makeBot());
    expect(fixture.posts).toEqual([]);
    expect(text()).toContain("Fixture desktop is not running");
  });

  it("leaves a stopped Auto computer asleep without a spinner or repeated polling", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    fixture.container = "stopped";
    await open(makeBot());
    const looks = fixture.looks;
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(fixture.looks).toBe(looks);
    expect(spinning()).toBe(false);
    expect(fixture.posts).toEqual([]);
  });

  it("prepares an explicitly selected VPS computer once and starts watching it", async () => {
    await open(makeBot({ computer: "cloud" }));
    expect(fixture.posts.filter((path) => !path.endsWith("/screenshot"))).toEqual(["/api/bots/scout/computer/provision"]);
    await expect.poll(() => document.querySelector("[data-live-screen]")).not.toBeNull();
    await open(makeBot({ computer: "cloud" }));
    expect(fixture.posts.filter((path) => path.endsWith("/provision"))).toHaveLength(1);
  });

  it("starts a stopped explicitly selected VPS computer without a provider sign-in", async () => {
    fixture.container = "stopped";
    await open(makeBot({ computer: "cloud" }));
    expect(fixture.posts.filter((path) => path.endsWith("/provision"))).toHaveLength(1);
    expect(document.querySelector("[data-live-screen]")).not.toBeNull();
    expect(text()).not.toMatch(/Boat|paid service|credits/);
  });

  it("does not provision before the VPS is configured", async () => {
    fixture.configured = false;
    await open(makeBot({ computer: "cloud" }));
    expect(fixture.posts).toEqual([]);
    expect(document.querySelector("[data-live-screen]")).toBeNull();
  });

  it("never replaces an incompatible existing computer on its own", async () => {
    fixture.container = "running";
    fixture.imageMatches = false;
    await open(makeBot({ computer: "cloud" }));
    expect(fixture.posts).toEqual([]);
    expect(document.querySelector("[data-live-screen]")).toBeNull();
  });

  it("keeps a conversation-only cloud pin read-only while the bot chats", async () => {
    fixture.container = "stopped";
    await open(makeBot({ busy: true, tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask", surface: "cloud", surfaceAuto: true }] } as Partial<Bot>));
    expect(fixture.posts).toEqual([]);
    expect(spinning()).toBe(false);
  });

  it("watches an already running VPS computer without creating or waking it", async () => {
    fixture.container = "running";
    await open(makeBot({ tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask", surface: "cloud", surfaceAuto: true }] } as Partial<Bot>));
    expect(document.querySelector("[data-live-screen]")).not.toBeNull();
    expect(fixture.posts.filter((path) => !path.endsWith("/screenshot"))).toEqual([]);
  });

  it("uses the same preparation behavior in Simple mode", async () => {
    fixture.advanced = false;
    await open(makeBot({ computer: "cloud" }));
    expect(fixture.posts.filter((path) => path.endsWith("/provision"))).toHaveLength(1);
    expect(document.querySelector("[data-live-screen]")).not.toBeNull();
  });
});
