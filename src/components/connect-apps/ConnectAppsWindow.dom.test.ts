// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  opened: [] as string[],
  closed: false,
  connected: { slack: { connected: true, accounts: [{ id: "ca_1", status: "ACTIVE" }] } } as Record<string, unknown>,
  dispatch: vi.fn(),
  memory: null as { services: Record<string, unknown>; authoritative: boolean } | null,
  inventory: null as Promise<{ services: Record<string, unknown>; authoritative: boolean }> | null,
  bundled: {
    source: "test", count: 3,
    toolkits: [
      { slug: "_1password", name: "1password", description: "Password manager and digital vault", category: "password manager", auth: ["API_KEY"], tools: 6 },
      { slug: "asana", name: "Asana", description: "Tasks and projects for teams", category: "project management", auth: ["OAUTH2"], managed: true as const, tools: 12, triggers: 1 },
      { slug: "attio", name: "Attio", description: "A CRM built for you", category: "crm", auth: ["OAUTH2", "API_KEY"], tools: 40 },
    ],
  },
  actions: { attio: { actions: ["Create record", "Find person"] } } as Record<string, { actions: string[]; triggers?: string[] }>,
}));

vi.mock("@/state/store", async (original) => {
  const store = await original<typeof import("@/state/store")>();
  return { ...store, api: fixture.api, useStore: () => ({ state: store.initialState, dispatch: fixture.dispatch }) };
});
vi.mock("./composio-snapshot", async (original) => ({
  ...await original<typeof import("./composio-snapshot")>(),
  loadComposioSnapshot: async () => fixture.bundled,
  cachedComposioSnapshot: () => null,
  snapshotToolkit: (slug: string) => fixture.bundled.toolkits.find((toolkit) => toolkit.slug === slug),
  loadToolkitActions: async (slug: string) => fixture.actions[slug] ?? null,
}));
vi.mock("@/lib/connected-apps", () => ({
  connectorStatusMemory: () => fixture.memory,
  rememberConnectorStatus: () => {},
  preloadConnectedApps: () => fixture.inventory ?? Promise.resolve({ services: fixture.connected, authoritative: true }),
}));
vi.mock("@/lib/connector-oauth", async (original) => ({
  ...await original<typeof import("@/lib/connector-oauth")>(),
  reserveConnectionPage: () => ({ open: async (url: string) => { fixture.opened.push(url); return true; }, cancel: () => {}, closed: () => fixture.closed }),
}));
vi.mock("@/lib/connector-poll", () => ({ pollConnector: () => () => {} }));
vi.mock("@/lib/logins", () => ({ listLogins: async () => ({ logins: [], onePassword: { connected: false } }) }));
vi.mock("@/lib/mcp-servers", () => ({ useMcpServers: () => ({ servers: [], error: false, refresh: async () => [] }) }));
vi.mock("../McpServersPanel", () => ({ McpServersPanel: () => null }));
vi.mock("../XCard", () => ({ XCard: () => null }));
vi.mock("../EmailCard", () => ({ EmailCard: () => null }));
vi.mock("./connector-helpers", () => ({ botsUsingService: () => [], connectorSetupNotice: () => null }));

import { ConnectAppsWindow } from "./ConnectAppsWindow";
import { ApiError } from "@/state/api";
import { managedCustomAuthReason } from "../../../shared/connector-availability";

// server/composio-project.ts noAuthConfigReason, as an app with its own Composio key hears it
const noAuthConfigReason = 'attio has no Composio-managed sign-in. In your Composio project, create an auth config for "attio" '
  + "(Auth Configs → Create) with your own app credentials, then click Connect again.";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (slug: string, label: string, category: string) => ({ slug, label, blurb: `${label} things`, logo: null, domain: null, categories: [category] });
const CARDS = [
  card("slack", "Slack", "Communication"), card("outlook", "Outlook", "Communication"), card("asana", "Asana", "Productivity"),
  card("linear", "Linear", "Developer tools"), card("figma", "Figma", "Design"), card("stripe", "Stripe", "Finance"), card("posthog", "PostHog", "Analytics"),
];

let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const button = (name: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === name || element.getAttribute("aria-label") === name);
const titles = () => [...dialog().querySelectorAll("section h3")].map((heading) => heading.textContent);
const flush = () => act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0); else await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(async () => {
  fixture.opened = [];
  fixture.closed = false;
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: string) => {
    if (path === "/api/connectors/catalog") return { configured: true, mode: "self-hosted", setup: "ready", source: "api", cards: CARDS };
    if (path.endsWith("/authorize")) return { url: "https://connect.example/asana" };
    return { services: {} };
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ skills: [{ name: "invoice-chaser", description: "Chase unpaid invoices" }] }) })));
  onClose = vi.fn<() => void>();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "home" }, nonce: 1, onClose, onTemplates: vi.fn() })); });
  await flush();
});

afterEach(() => {
  fixture.memory = null;
  fixture.inventory = null;
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the Connect Apps window", () => {
  it("opens on Grok's home: the title, what is connected, search, chips and the sections, recommendations first", () => {
    expect(dialog().getAttribute("aria-label")).toBe("Connect Apps");
    expect(button("Your plugins")?.textContent).toContain("1 connected");
    expect(dialog().querySelector('[role="combobox"]')?.getAttribute("placeholder")).toBe("Search across apps and skills");
    expect(dialog().querySelector("[data-bot-templates-link]")?.textContent).toContain("Bot templates");
    const chips = [...dialog().querySelectorAll('[data-marketplace-chips] button')].map((chip) => chip.textContent?.replace(/[\uE000-\uF8FF]/gu, ""));
    expect(chips).toEqual(["All", "Password Managers", "Productivity", "Communication", "Design", "Code", "More"]);
    expect(titles().slice(0, 2), "what is connected leads, then the rest").toEqual(["Connected", "Recommended for you"]);
    expect(titles()).toContain("Password Managers");
    expect(dialog().querySelector('#ca-section-connected')?.closest("section")?.querySelector('[data-app-row="slack"]')?.textContent).toContain("Connected");
    expect(dialog().querySelectorAll('[data-app-row="slack"]'), "a connected app is not listed twice").toHaveLength(1);
    expect(dialog().querySelector('[data-app-row="outlook"] .ca-pill')?.getAttribute("aria-label")).toBe("Connect Outlook");
    expect(dialog().querySelector('[data-app-row="outlook"] .ca-row-subtitle')?.textContent, "each row says what its app does, as grok's do").toBeTruthy();
  });

  it("shows one category from its chip and goes back to All from it again", async () => {
    await act(async () => { button("Design")!.click(); });
    expect(titles()).toEqual(["Design"]);
    expect(button("Design")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button("Communication")!.click(); });
    expect(titles(), "a category's connected apps come first").toEqual(["Connected", "Communication"]);
    await act(async () => { button("Communication")!.click(); });
    expect(titles()[0]).toBe("Connected");
  });

  it("finds apps, skills and categories as you type, and opens the one Enter picks", async () => {
    const input = dialog().querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "in");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const groups = [...dialog().querySelectorAll('[role="listbox"] [role="group"]')].map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Plugins", "Skills", "Categories"]);
    expect(dialog().querySelector('[role="option"]')?.textContent).toContain("Linear");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(input.getAttribute("aria-activedescendant")).toBe("ca-option-0");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(dialog().querySelector("[data-app-page]")?.getAttribute("data-app-page")).toBe("linear");
    await act(async () => { button("Back")!.click(); });
    expect(dialog().querySelector("[data-app-page]")).toBeNull();
  });

  it("connects an app from its row: Connecting… while it asks, then the sign-in page opens", async () => {
    let finish: (value: unknown) => void = () => {};
    fixture.api.mockImplementation(async (path: string) => path.endsWith("/authorize") ? new Promise((resolve) => { finish = resolve; }) : { services: {} });
    const pill = () => dialog().querySelector<HTMLButtonElement>('[data-app-row="asana"] .ca-pill')!;
    await act(async () => { pill().click(); });
    expect(fixture.api).toHaveBeenCalledWith("/api/connectors/asana/authorize", { method: "POST" });
    expect(pill().disabled).toBe(true);
    expect(pill().querySelector("span:not([aria-hidden])")?.textContent).toBe("Connecting…");
    await act(async () => { finish({ url: "https://connect.example/asana" }); });
    await flush();
    expect(fixture.opened).toEqual(["https://connect.example/asana"]);
  });

  it("one app stuck connecting never holds the others, and Cancel puts it back", async () => {
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/connectors/asana/authorize") return new Promise(() => {});
      if (path.endsWith("/authorize")) return { url: "https://connect.example/linear" };
      return { services: {} };
    });
    const row = (slug: string) => dialog().querySelector<HTMLElement>(`[data-app-row="${slug}"]`)!;
    const pill = (slug: string) => row(slug).querySelector<HTMLButtonElement>(".ca-pill")!;
    await act(async () => { pill("asana").click(); });
    expect(pill("asana").disabled).toBe(true);
    expect(row("asana").querySelector("[data-cancel]")?.textContent).toBe("Cancel");
    await act(async () => { pill("linear").click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/connectors/linear/authorize", { method: "POST" });
    expect(fixture.opened).toEqual(["https://connect.example/linear"]);
    await act(async () => { row("asana").querySelector<HTMLButtonElement>("[data-cancel]")!.click(); });
    expect(pill("asana").disabled).toBe(false);
    expect(pill("asana").getAttribute("aria-label")).toBe("Connect Asana");
    expect(row("asana").querySelector("[data-cancel]")).toBeNull();
  });

  it("lists every Composio app the live catalog lacks, with what it can do and how you sign in on its page", async () => {
    expect(dialog().querySelector('[data-app-row="attio"] .ca-row-subtitle')?.textContent).toBe("A CRM built for you");
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="attio"] .ca-row-open')!.click(); });
    await flush();
    const page = dialog().querySelector("[data-app-page]")!;
    expect(page.getAttribute("data-app-page")).toBe("attio");
    expect([...page.querySelectorAll('[data-toolkit-group="actions"] .ca-card-row')].map((row) => row.textContent))
      .toEqual(["Create record", "Find person", "See all 40 on Composio"]);
    expect(page.querySelector<HTMLAnchorElement>('[data-toolkit-group="actions"] a')?.href).toBe("https://docs.composio.dev/toolkits/attio");
    expect(page.textContent).toContain("Your account, API key");
  });

  it("sends an app Composio has no managed sign-in for to Composio to set up, then Check again connects it", async () => {
    let made = false;
    fixture.api.mockImplementation(async (path: string) => {
      if (path !== "/api/connectors/attio/authorize") return { services: {} };
      if (made) return { url: "https://connect.example/attio" };
      throw new ApiError(noAuthConfigReason, 400, { error: noAuthConfigReason });
    });
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="attio"] .ca-pill')!.click(); });
    await flush();
    expect(fixture.opened).toEqual(["https://dashboard.composio.dev/~/project/auth-configs"]);
    const page = dialog().querySelector("[data-app-page]")!;
    expect(page.getAttribute("data-app-page"), "a row's Connect lands on the page that says what to do").toBe("attio");
    const line = page.querySelector("[data-composio-setup]")!;
    expect(line.textContent).toContain("Attio is set up on Composio: click Create Auth Config there, pick Attio, then check again.");
    expect(line.querySelector("a")?.getAttribute("href")).toBe("https://dashboard.composio.dev/~/project/auth-configs");
    expect(line.textContent).not.toContain("Open settings");
    expect(dialog().textContent, "no dead-end toast").not.toContain("has no Composio-managed sign-in");
    const again = page.querySelector<HTMLButtonElement>(".ca-primary")!;
    expect(again.textContent).toContain("Check again");
    made = true;
    await act(async () => { again.click(); });
    await flush();
    expect(fixture.opened.at(-1)).toBe("https://connect.example/attio");
    expect(dialog().querySelector("[data-composio-setup]")).toBeNull();
  });

  describe("Connect asks for a Composio key right here", () => {
    let keySaved = false;
    let connectedAfterKey: Record<string, unknown> = {};
    const remount = async (page: Parameters<typeof ConnectAppsWindow>[0]["page"], mode: string) => {
      act(() => root.unmount());
      keySaved = false;
      fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path === "/api/connectors/catalog") {
          return keySaved
            ? { configured: true, mode: "self-hosted", setup: "ready", source: "api", cards: CARDS }
            : { configured: mode === "managed", mode, setup: mode === "managed" ? "ready" : "needs-setup", source: "curated", cards: CARDS };
        }
        if (path === "/api/config" && init?.method === "PUT") {
          const sent = JSON.parse(String(init.body)) as { composio?: { apiKey?: string } };
          if (sent.composio?.apiKey !== "ak_good") throw new ApiError("Composio rejected this key (HTTP 401)", 400, { error: "Composio rejected this key (HTTP 401)" });
          keySaved = true;
          return { composio: { mode: "self-hosted", configured: true } };
        }
        if (path === "/api/connectors/attio/authorize") {
          if (!keySaved) throw new ApiError(managedCustomAuthReason("attio"), 409, { error: managedCustomAuthReason("attio") });
          return { url: "https://connect.example/attio" };
        }
        return { services: {} };
      });
      const original = fixture.connected;
      fixture.connected = new Proxy({}, { get: (_target, key: string) => (keySaved ? connectedAfterKey : original)[key], ownKeys: () => Reflect.ownKeys(keySaved ? connectedAfterKey : original), getOwnPropertyDescriptor: (_target, key) => ({ enumerable: true, configurable: true, value: (keySaved ? connectedAfterKey : original)[key as string] }) });
      const { loadConnectorCatalog } = await import("./use-connectors");
      await loadConnectorCatalog();
      root = createRoot(document.body.appendChild(document.createElement("div")));
      await act(async () => { root.render(createElement(ConnectAppsWindow, { page, nonce: 4, onClose, onTemplates: vi.fn() })); });
      await flush();
    };
    const paste = async (value: string) => {
      const own = [...dialog().querySelectorAll<HTMLButtonElement>("[data-composio-key] button")].find((element) => element.textContent === "Use my own Composio API key");
      if (own) await act(async () => { own.click(); });
      const input = dialog().querySelector<HTMLInputElement>("[data-composio-key] input")!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { input.form!.requestSubmit(); });
      await flush();
    };
    afterEach(() => { connectedAfterKey = {}; fixture.connected = { slack: { connected: true, accounts: [{ id: "ca_1", status: "ACTIVE" }] } }; });

    it("without a broker or a key: a row's Connect opens the key step, and the key verifies, saves and connects the app", async () => {
      await remount({ kind: "home" }, "unavailable");
      expect(dialog().querySelector('[data-app-row="attio"]')).not.toBeNull();
      await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="attio"] .ca-pill')!.click(); });
      await flush();
      expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/attio/authorize", expect.anything());
      expect(onClose, "no trip to Settings").not.toHaveBeenCalled();
      const step = dialog().querySelector("[data-app-page='attio'] [data-composio-key]")!;
      expect(step.textContent).toContain("Dusk uses Composio to reach Attio. First, let Dusk use your free Composio account. You'll sign in once.");
      expect(step.textContent, "what is shared").toContain("Dusk never sees your Attio password.");
      expect(dialog().querySelector("[data-app-page] [data-composio-sign-in]")?.textContent, "authorizing is the first step, said as such").toContain("Authorize Composio");
      await act(async () => { [...step.querySelectorAll("button")].find((element) => element.textContent === "Use my own Composio API key")!.click(); });
      expect([...step.querySelectorAll("li")].map((item) => item.textContent?.replace(/^\d/, ""))).toEqual([
        "Sign up or log in to ComposioOpen Composio", "Copy your API key from Settings, API KeysOpen API Keys", "Paste it here and Attio connects",
      ]);
      expect([...step.querySelectorAll("a")].map((link) => link.getAttribute("href")))
        .toEqual(["https://dashboard.composio.dev", "https://dashboard.composio.dev/~/project/settings/api-keys"]);
      await paste("ak_good");
      expect(fixture.api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ composio: { apiKey: "ak_good" } }) });
      expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: { composio: { mode: "self-hosted", configured: true } } });
      expect(fixture.api).toHaveBeenCalledWith("/api/connectors/attio/authorize", { method: "POST" });
      expect(fixture.opened).toEqual(["https://connect.example/attio"]);
      expect(dialog().querySelector("[data-composio-key]")).toBeNull();
    });

    // composio connect, signed in or not; `apps` answers the app's GET (status) and POST (connect)
    const viaApi = (state: { signedIn: boolean; enabled?: boolean }, apps: (method: string) => unknown) => {
      const base = fixture.api.getMockImplementation()!;
      fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path === "/api/connectors/composio-connect") return { added: state.signedIn, name: state.signedIn ? "composio-connect" : null, signedIn: state.signedIn, enabled: state.enabled ?? state.signedIn };
        if (path === "/api/mcp/servers" && init?.method === "POST") return { servers: [] };
        if (path === "/api/mcp/servers/composio-connect/sign-in") { state.signedIn = true; return { auth: { phase: "succeeded", flowId: null, authorizationUrl: null } }; }
        if (path === "/api/mcp/servers/composio-connect" && init?.method === "PATCH") { state.enabled = true; return { servers: [] }; }
        if (path === "/api/connectors/composio-connect/apps/attio") return apps(init?.method ?? "GET");
        return base(path, init);
      });
    };
    const primary = () => dialog().querySelector<HTMLButtonElement>("[data-app-page] .ca-detail-header .ca-primary");
    const shownLabel = () => primary()?.querySelector("span:not([aria-hidden])")?.textContent;
    const steps = () => [...dialog().querySelectorAll("[data-via-step]")].map((step) => `${step.getAttribute("data-via-step")}:${step.getAttribute("data-state")}`);
    const line = () => dialog().querySelector("[data-via-line] > span")?.textContent;
    const remountAt = async (nonce: number) => {
      act(() => root.unmount());
      root = createRoot(document.body.appendChild(document.createElement("div")));
      await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "detail", id: "attio" }, nonce, onClose, onTemplates: vi.fn() })); });
      await flush();
    };
    const keep = () => {
      const kept = new Map<string, string>();
      vi.stubGlobal("localStorage", { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); }, removeItem: (key: string) => { kept.delete(key); } });
      return kept;
    };

    it("two steps, each said for what it does: Authorize Composio, then Connect Attio, then Connected and on for bots", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        keep();
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        let connected = false;
        const state = { signedIn: false, enabled: false as boolean | undefined };
        viaApi(state, (method) => method === "POST" ? { status: "started", url: "https://connect.composio.dev/link/ln_attio" } : { status: connected ? "connected" : "waiting" });
        expect(shownLabel()).toBe("Authorize Composio");
        expect(steps()).toEqual(["authorize:current", "connect:next"]);
        await act(async () => { primary()!.click(); });
        await flush();
        expect(fixture.api).toHaveBeenCalledWith("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name: "composio-connect", type: "http", url: "https://connect.composio.dev/mcp", enabled: false }) });
        expect(fixture.api).not.toHaveBeenCalledWith("/api/config", expect.anything());
        expect(fixture.opened, "step two waits for its own click").toEqual([]);
        expect(steps()).toEqual(["authorize:done", "connect:current"]);
        expect(dialog().querySelector("[data-via-step=authorize] > span:last-child")?.textContent).toBe("Composio authorized");
        expect(shownLabel()).toBe("Connect Attio");
        expect(dialog().textContent).toContain("Now sign in to Attio on Composio's page.");
        await act(async () => { primary()!.click(); });
        await flush();
        expect(fixture.api).toHaveBeenCalledWith("/api/connectors/composio-connect/apps/attio", expect.objectContaining({ method: "POST" }));
        expect(fixture.opened).toEqual(["https://connect.composio.dev/link/ln_attio"]);
        expect(shownLabel()).toBe("Open page again");
        expect(line()).toBe("Finish signing in on Composio's page. This updates by itself.");
        await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
        expect(fixture.api, "waiting only reads").toHaveBeenCalledWith("/api/connectors/composio-connect/apps/attio", expect.objectContaining({ method: "GET" }));
        expect(fixture.api.mock.calls.filter(([path, init]) => path === "/api/connectors/composio-connect/apps/attio" && init?.method === "POST")).toHaveLength(1);
        connected = true;
        await act(async () => { window.dispatchEvent(new Event("focus")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(steps()).toEqual(["authorize:done", "connect:done"]);
        expect(line()).toBe("Connected. Your bots can use Attio now.");
        expect(primary(), "connected: nothing left to click").toBeNull();
        expect(dialog().querySelector("[data-app-page] .ca-detail-header .ca-added")?.textContent).toContain("Connected");
        expect(fixture.api, "on for bots").toHaveBeenCalledWith("/api/mcp/servers/composio-connect", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
        expect(dialog().textContent, "a short confirmation").toContain("Added Attio");
        await act(async () => { button("Back")!.click(); });
        expect(dialog().querySelector('#ca-section-connected')?.closest("section")?.querySelector('[data-app-row="attio"]')?.textContent, "in the Connected group").toContain("Connected");
      } finally {
        vi.useRealTimers();
      }
    });

    it("an app Composio Connect already has shows connected on opening, without starting a sign-in, and turns the server on for bots", async () => {
      const kept = keep();
      await remount({ kind: "detail", id: "attio" }, "unavailable");
      // the live harness on 2026-11-07: signed in, the server left off
      viaApi({ signedIn: true, enabled: false }, () => ({ status: "connected" }));
      await remountAt(5);
      expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/composio-connect/apps/attio", expect.objectContaining({ method: "POST" }));
      expect(fixture.opened).toEqual([]);
      expect(JSON.parse(kept.get("dusk.composioConnect.apps") ?? "{}")).toEqual({ attio: true });
      expect(primary(), "connected: nothing left to click").toBeNull();
      expect(fixture.api).toHaveBeenCalledWith("/api/mcp/servers/composio-connect", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    });

    describe("failures say what happened and how to go on", () => {
      const waitingThen = async (answer: () => unknown, advance: number) => {
        keep();
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        viaApi({ signedIn: true }, (method) => method === "POST" ? { status: "started", url: "https://connect.composio.dev/link/ln_attio" } : answer());
        await remountAt(6);
        await act(async () => { primary()!.click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(advance); });
      };
      beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
      afterEach(() => { vi.useRealTimers(); });

      it("the link expires: timeout, Retry", async () => {
        await waitingThen(() => ({ status: "waiting" }), 10 * 60_000 + 20_000);
        expect(line()).toBe("Attio didn't connect in time, so the sign-in link expired.");
        expect(dialog().querySelector("[data-via-line]")?.getAttribute("role")).toBe("alert");
        expect(shownLabel()).toBe("Retry");
      });

      it("the sign-in page is closed before the app connects: cancelled, Retry", async () => {
        await waitingThen(() => ({ status: "waiting" }), 0);
        fixture.closed = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
        expect(line()).toBe("The sign-in page closed before Attio connected.");
        expect(shownLabel()).toBe("Retry");
      });

      it("coming back without finishing says so and keeps waiting", async () => {
        await waitingThen(() => ({ status: "waiting" }), 0);
        await act(async () => { window.dispatchEvent(new Event("focus")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(line()).toBe("Not connected yet. If you closed Composio's page, open it again.");
        expect(shownLabel()).toBe("Open page again");
      });

      it("the Composio sign-in expired: Authorize again", async () => {
        await waitingThen(() => { throw new ApiError("Composio sign-in expired. Authorize Composio again.", 409, { code: "composio_connect_signed_out" }); }, 2_100);
        expect(line()).toBe("Your Composio sign-in expired. Authorize Composio again.");
        expect(shownLabel()).toBe("Authorize again");
        expect(steps()).toEqual(["authorize:current", "connect:next"]);
      });

      it("Dusk restarting or the network down: says so and keeps trying, then connects", async () => {
        let down = true;
        await waitingThen(() => { if (down) throw new TypeError("Failed to fetch"); return { status: "connected" }; }, 2_100);
        expect(line()).toBe("Can't reach Composio right now. Trying again…");
        down = false;
        await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
        expect(line()).toBe("Connected. Your bots can use Attio now.");
      });

      it("never reachable until the link expires: offline, Retry", async () => {
        await waitingThen(() => { throw new ApiError("Couldn't reach Composio.", 502, { code: "composio_unreachable" }); }, 10 * 60_000 + 20_000);
        expect(line()).toBe("Couldn't reach Composio for a while. Check your connection and retry.");
        expect(shownLabel()).toBe("Retry");
      });

      it("Composio refuses: its own words, Retry", async () => {
        keep();
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        viaApi({ signedIn: true }, (method) => method === "POST" ? { status: "failed", message: "Toolkit attio is not enabled" } : { status: "none" });
        await remountAt(7);
        await act(async () => { primary()!.click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(line()).toBe("Composio couldn't connect Attio: Toolkit attio is not enabled");
        expect(shownLabel()).toBe("Retry");
      });

      it("authorizing does not finish: one line, Retry", async () => {
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        const base = fixture.api.getMockImplementation()!;
        fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
          if (path === "/api/connectors/composio-connect") return { added: false, name: null, signedIn: false, enabled: false };
          if (path === "/api/mcp/servers" && init?.method === "POST") return { servers: [] };
          if (path === "/api/mcp/servers/composio-connect/sign-in") return { auth: { phase: "failed", flowId: null, authorizationUrl: null, message: "denied" } };
          return base(path, init);
        });
        await act(async () => { primary()!.click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(line()).toBe("Composio wasn't authorized. Try again.");
        expect(shownLabel()).toBe("Retry");
      });

      it("a reload mid sign-in picks the wait up again", async () => {
        const kept = keep();
        kept.set("dusk.composioConnect.pending", JSON.stringify({ attio: { url: "https://connect.composio.dev/link/ln_attio", since: Date.now() - 60_000 } }));
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        viaApi({ signedIn: true }, () => ({ status: "waiting" }));
        await remountAt(8);
        expect(shownLabel()).toBe("Open page again");
        expect(line()).toBe("Finish signing in on Composio's page. This updates by itself.");
      });

      it("a saved wait is checked before it shows: one Composio no longer has, or one past its deadline, is dropped", async () => {
        const kept = keep();
        kept.set("dusk.composioConnect.pending", JSON.stringify({
          attio: { url: "https://connect.composio.dev/link/ln_attio", since: Date.now() - 60_000 },
          asana: { url: "https://connect.composio.dev/link/ln_asana", since: Date.now() - 11 * 60_000 },
        }));
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        viaApi({ signedIn: true }, () => ({ status: "none" }));
        await remountAt(9);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(fixture.api, "only read").not.toHaveBeenCalledWith("/api/connectors/composio-connect/apps/attio", expect.objectContaining({ method: "POST" }));
        expect(fixture.api, "past its deadline: not even asked").not.toHaveBeenCalledWith("/api/connectors/composio-connect/apps/asana", expect.anything());
        expect(shownLabel()).toBe("Connect Attio");
        expect(line()).toBeUndefined();
        expect(JSON.parse(kept.get("dusk.composioConnect.pending") ?? "{}")).toEqual({});
      });

      it("Cancel stops the wait at once and says Connect again", async () => {
        await waitingThen(() => ({ status: "waiting" }), 0);
        expect(shownLabel()).toBe("Open page again");
        const cancel = dialog().querySelector<HTMLButtonElement>("[data-app-page] .ca-detail-header [data-cancel]")!;
        expect(cancel.textContent).toBe("Cancel");
        await act(async () => { cancel.click(); });
        expect(shownLabel()).toBe("Connect Attio");
        expect(line()).toBeUndefined();
        expect(dialog().querySelector("[data-cancel]")).toBeNull();
        const reads = fixture.api.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(fixture.api.mock.calls.length, "no more polling").toBe(reads);
      });

      it("an authorize left unfinished: back here a while without it, it fails with Retry instead of spinning", async () => {
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        const base = fixture.api.getMockImplementation()!;
        fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
          if (path === "/api/connectors/composio-connect") return { added: false, name: null, signedIn: false, enabled: false };
          if (path === "/api/mcp/servers" && init?.method === "POST") return { servers: [] };
          if (path === "/api/mcp/servers/composio-connect/sign-in") return { auth: { phase: "waiting", flowId: "f1", authorizationUrl: "https://connect.composio.dev/oauth/f1" } };
          if (path === "/api/mcp/servers/composio-connect/sign-in/f1") return init?.method === "DELETE" ? {} : { auth: { phase: "waiting", flowId: "f1", authorizationUrl: null } };
          return base(path, init);
        });
        await act(async () => { primary()!.click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(shownLabel()).toBe("Waiting for Composio…");
        await act(async () => { window.dispatchEvent(new Event("blur")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
        expect(shownLabel(), "away on the sign-in page: still waiting").toBe("Waiting for Composio…");
        await act(async () => { window.dispatchEvent(new Event("focus")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(76_000); });
        expect(line()).toBe("Composio wasn't authorized. Try again.");
        expect(shownLabel()).toBe("Retry");
        expect(fixture.api, "the sign-in is called off").toHaveBeenCalledWith("/api/mcp/servers/composio-connect/sign-in/f1", { method: "DELETE" });
      });
    });

    it("a key Composio refuses says so in one line and connects nothing", async () => {
      await remount({ kind: "detail", id: "attio" }, "unavailable");
      await paste("ak_bad");
      expect(dialog().querySelector("[data-composio-key] [role=alert] > span")?.textContent).toBe("Composio didn't accept that key. Copy it again from API Keys.");
      expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/attio/authorize", expect.anything());
      await paste("not a key");
      expect(dialog().querySelector("[data-composio-key] [role=alert] > span")?.textContent).toBe("Composio keys start with ak_. Copy it again from API Keys.");
    });

    it("with the managed broker, an app it cannot sign in to asks for the person's own key instead of a dead end", async () => {
      await remount({ kind: "detail", id: "attio" }, "managed");
      await act(async () => { dialog().querySelector<HTMLButtonElement>("[data-app-page] .ca-primary")!.click(); });
      await flush();
      expect(fixture.opened, "no Composio tab the broker could not use").toEqual([]);
      expect(dialog().querySelector("[data-composio-key]")?.textContent).toContain("Dusk uses Composio to reach Attio.");
      await paste("ak_good");
      expect(fixture.opened).toEqual(["https://connect.example/attio"]);
    });

    it("an app the key's project already has shows connected without signing in again", async () => {
      connectedAfterKey = { attio: { connected: true, accounts: [{ id: "ca_attio_dash", status: "ACTIVE" }] } };
      await remount({ kind: "detail", id: "attio" }, "unavailable");
      await paste("ak_good");
      expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/attio/authorize", expect.anything());
      expect(fixture.opened).toEqual([]);
      expect(dialog().querySelector("[data-app-page='attio'] [data-account='ca_attio_dash']")).not.toBeNull();
    });
  });

  it("lists accounts as grok does: Disconnect asks again in place, then removes it", async () => {
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="slack"] .ca-row-open')!.click(); });
    await flush();
    const row = () => dialog().querySelector("[data-account='ca_1']")!;
    expect(row().textContent).toContain("Linked account");
    expect(dialog().querySelector("[data-accounts]")?.textContent).toContain("Add account");
    await act(async () => { row().querySelector<HTMLButtonElement>('[aria-label^="Disconnect"]')!.click(); });
    expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/slack/accounts/ca_1", expect.anything());
    const confirm = row().querySelector<HTMLButtonElement>('[aria-label="Confirm disconnecting Linked account"]')!;
    expect(confirm.textContent).toBe("Confirm Disconnect");
    await act(async () => { confirm.click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/connectors/slack/accounts/ca_1", { method: "DELETE" });
  });

  it("lists our 1Password and Composio's as one row, and its page offers both ways in", async () => {
    expect(dialog().querySelectorAll('[data-app-row="1password"]')).toHaveLength(1);
    expect(dialog().querySelector('[data-app-row="_1password"]'), "composio's listing folds into ours").toBeNull();
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="1password"] .ca-row-open')!.click(); });
    await flush();
    const ways = [...dialog().querySelectorAll("[data-ways] [data-way]")];
    expect(ways.map((way) => [way.getAttribute("data-way"), way.querySelector("span")?.textContent])).toEqual([
      ["own", "Share a vault (built in)"], ["composio", "Connect via Composio"],
    ]);
    await act(async () => { ways[1]!.querySelector<HTMLButtonElement>(".ca-pill")!.click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/connectors/_1password/authorize", { method: "POST" });
    expect(dialog().querySelector("[data-app-page]")?.getAttribute("data-app-page"), "it stays on our page").toBe("1password");
  });

  it("keeps every row in place when live answers come after the first frame: only a row's button changes", async () => {
    act(() => root.unmount());
    let answerCatalog: (value: unknown) => void = () => {};
    let answerStatus: (value: { services: Record<string, unknown>; authoritative: boolean }) => void = () => {};
    fixture.memory = { services: fixture.connected, authoritative: true };
    fixture.inventory = new Promise((resolve) => { answerStatus = resolve; });
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/connectors/catalog") return new Promise((resolve) => { answerCatalog = resolve; });
      return { services: {} };
    });
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "home" }, nonce: 6, onClose, onTemplates: vi.fn() })); });
    await flush();
    const rows = () => [...dialog().querySelectorAll("[data-app-row]")].map((row) => row.getAttribute("data-app-row"));
    const first = rows();
    const sections = titles();
    expect(first, "the first frame already has the cached catalog").toEqual(expect.arrayContaining(["slack", "asana", "linear", "attio"]));
    expect(dialog().querySelector('[data-app-row="asana"]')?.textContent).not.toContain("Connected");
    await act(async () => { answerCatalog({ configured: true, mode: "self-hosted", setup: "ready", source: "api", cards: [...CARDS].reverse() }); });
    await act(async () => { answerStatus({ services: { ...fixture.connected, asana: { connected: true, accounts: [{ id: "ca_2", status: "ACTIVE" }] } }, authoritative: true }); });
    await flush();
    expect(rows(), "no row moves or appears").toEqual(first);
    expect(titles()).toEqual(sections);
    expect(dialog().querySelector('[data-app-row="asana"]')?.textContent, "the badge updates in place").toContain("Connected");
  });

  it("adds any MCP server from the Custom MCP row", async () => {
    const custom = dialog().querySelector('[data-app-row="custom-mcp"]')!;
    expect(custom.textContent).toContain("Custom MCP");
    await act(async () => { custom.querySelector<HTMLButtonElement>(".ca-pill")!.click(); });
    expect(dialog().querySelector("[data-detail-hero-title]")?.textContent).toBe("Custom MCP");
  });

  it("closes on Escape, and the search's Escape only closes its results", async () => {
    const input = dialog().querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "sla");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog().querySelector('[role="listbox"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
