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
// sealing has its own tests (src/lib/sealed-send.test.ts): here the patch the key step asked to save is what the server gets
vi.mock("@/lib/sealed-send", () => ({ putConfig: (patch: unknown) => fixture.api("/api/config", { method: "PUT", body: JSON.stringify(patch) }) }));
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
  card("slack", "Slack", "communication"), card("outlook", "Outlook", "communication"), card("asana", "Asana", "productivity"),
  card("linear", "Linear", "developer tools"), card("figma", "Figma", "design"), card("stripe", "Stripe", "finance"), card("posthog", "PostHog", "analytics"),
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
    expect(dialog().getAttribute("aria-label")).toBe("connect apps");
    expect(button("your plugins")?.textContent).toContain("1 connected");
    expect(dialog().querySelector('[role="combobox"]')?.getAttribute("placeholder")).toBe("search across apps and skills");
    expect(dialog().querySelector("[data-bot-templates-link]")?.textContent).toContain("bot templates");
    const chips = [...dialog().querySelectorAll('[data-marketplace-chips] button')].map((chip) => chip.textContent?.replace(/[\uE000-\uF8FF]/gu, ""));
    expect(chips).toEqual(["all", "password managers", "productivity", "communication", "design", "code", "more"]);
    expect(titles().slice(0, 2), "what is connected leads, then every app in one list").toEqual(["connected", "apps"]);
    expect(dialog().querySelector('[data-app-row="asana"] .ca-pill span:not([aria-hidden])')?.textContent, "a Composio app's row reads like any other").toBe("connect");
    expect(dialog().textContent, "no separate sign-in buttons").not.toContain("sign in with Composio");
    expect(dialog().querySelector('#ca-section-connected')?.closest("section")?.querySelector('[data-app-row="slack"]')?.textContent).toContain("connected");
    expect(dialog().querySelectorAll('[data-app-row="slack"]'), "a connected app is not listed twice").toHaveLength(1);
    expect(dialog().querySelector('[data-app-row="outlook"] .ca-pill')?.getAttribute("aria-label")).toBe("connect Outlook");
    expect(dialog().querySelector('[data-app-row="outlook"] .ca-row-subtitle')?.textContent, "each row says what its app does, as grok's do").toBeTruthy();
  });

  it("asks for a token only for an app nothing else connects: one Composio covers is a normal Composio row", async () => {
    const open = async (id: string) => {
      act(() => root.unmount());
      root = createRoot(document.body.appendChild(document.createElement("div")));
      await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "detail", id }, nonce: 9, onClose, onTemplates: vi.fn() })); });
      await flush();
    };
    await open("linear");
    expect(dialog().querySelector("[data-token-app]"), "Linear is in Composio: no token to paste").toBeNull();
    expect(dialog().querySelector("[data-app-page]")?.getAttribute("data-app-page")).toBe("linear");
    await open("trello");
    expect(dialog().querySelector("[data-token-app='trello']"), "Trello is in no catalog here: its token guide").not.toBeNull();
    expect(dialog().querySelector("[data-token-app='trello'] [data-guide-step='paste'] input")).not.toBeNull();
  });

  it("shows one category from its chip and goes back to All from it again", async () => {
    await act(async () => { button("design")!.click(); });
    expect(titles()).toEqual(["design"]);
    expect(button("design")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button("communication")!.click(); });
    expect(titles(), "a category's connected apps come first").toEqual(["connected", "communication"]);
    await act(async () => { button("communication")!.click(); });
    expect(titles()[0]).toBe("connected");
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
    expect(groups).toEqual(["plugins", "skills", "categories"]);
    expect(dialog().querySelector('[role="option"]')?.textContent).toContain("Linear");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(input.getAttribute("aria-activedescendant")).toBe("ca-option-0");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(dialog().querySelector("[data-app-page]")?.getAttribute("data-app-page")).toBe("linear");
    await act(async () => { button("back")!.click(); });
    expect(dialog().querySelector("[data-app-page]")).toBeNull();
  });

  it("connects an app from its row: Connecting… while it asks, then the sign-in page opens", async () => {
    let finish: (value: unknown) => void = () => {};
    fixture.api.mockImplementation(async (path: string) => path.endsWith("/authorize") ? new Promise((resolve) => { finish = resolve; }) : { services: {} });
    const pill = () => dialog().querySelector<HTMLButtonElement>('[data-app-row="asana"] .ca-pill')!;
    await act(async () => { pill().click(); });
    expect(fixture.api).toHaveBeenCalledWith("/api/connectors/asana/authorize", { method: "POST" });
    expect(pill().disabled).toBe(true);
    expect(pill().querySelector("span:not([aria-hidden])")?.textContent).toBe("connecting…");
    await act(async () => { finish({ url: "https://connect.example/asana" }); });
    await flush();
    expect(fixture.opened).toEqual(["https://connect.example/asana"]);
  });

  // regression: with a key the page showed only Open page again, no word that it was waiting or that it updates by itself
  it("says a key's sign-in is waiting on the page that opened, and Cancel ends the wait", async () => {
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "detail", id: "asana" }, nonce: 3, onClose, onTemplates: vi.fn() })); });
    await flush();
    const primary = () => dialog().querySelector<HTMLButtonElement>(".ca-primary")!;
    const shown = () => primary().querySelector("span:not([aria-hidden])")?.textContent;
    expect(shown()).toBe("connect Asana");
    await act(async () => { primary().click(); });
    await flush();
    expect(fixture.opened).toEqual(["https://connect.example/asana"]);
    const line = dialog().querySelector("[data-connect-line]");
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.textContent).toBe("Finish signing in on the page that opened. This updates by itself.");
    expect(shown(), "the line sits beside the button that reopens the page").toBe("open page again");
    await act(async () => { dialog().querySelector<HTMLButtonElement>("[data-cancel]")!.click(); });
    expect(dialog().querySelector("[data-connect-line]")).toBeNull();
    expect(shown()).toBe("connect Asana");
  });

  it("one app stuck connecting never holds the others, and Cancel puts it back", async () => {
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/connectors/asana/authorize") return new Promise(() => {});
      if (path.endsWith("/authorize")) return { url: "https://connect.example/figma" };
      return { services: {} };
    });
    const row = (slug: string) => dialog().querySelector<HTMLElement>(`[data-app-row="${slug}"]`)!;
    const pill = (slug: string) => row(slug).querySelector<HTMLButtonElement>(".ca-pill")!;
    await act(async () => { pill("asana").click(); });
    expect(pill("asana").disabled).toBe(true);
    expect(row("asana").querySelector("[data-cancel]")?.textContent).toBe("cancel");
    await act(async () => { pill("figma").click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/connectors/figma/authorize", { method: "POST" });
    expect(fixture.opened).toEqual(["https://connect.example/figma"]);
    await act(async () => { row("asana").querySelector<HTMLButtonElement>("[data-cancel]")!.click(); });
    expect(pill("asana").disabled).toBe(false);
    expect(pill("asana").getAttribute("aria-label")).toBe("connect Asana");
    expect(row("asana").querySelector("[data-cancel]")).toBeNull();
  });

  it("lists every Composio app the live catalog lacks, with what it can do on its page", async () => {
    expect(dialog().querySelector('[data-app-row="attio"] .ca-row-subtitle')?.textContent).toBe("A CRM built for you");
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="attio"] .ca-row-open')!.click(); });
    await flush();
    const page = dialog().querySelector("[data-app-page]")!;
    expect(page.getAttribute("data-app-page")).toBe("attio");
    const toggle = page.querySelector<HTMLButtonElement>('[data-toolkit-group="actions"] .ca-abilities-toggle')!;
    expect(toggle.textContent, "folded to one quiet row with its count").toBe("what Attio can do40");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(page.querySelector("[data-ability]")).toBeNull();
    await act(async () => { toggle.click(); });
    const abilities = () => [...page.querySelectorAll("[data-ability]")].map((row) => row.textContent);
    expect(abilities()).toEqual(["Create record", "Find person"]);
    expect(page.querySelector<HTMLAnchorElement>('[data-toolkit-group="actions"] a')?.href).toBe("https://docs.composio.dev/toolkits/attio");
    const search = page.querySelector<HTMLInputElement>('[data-toolkit-group="actions"] input[type=search]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "find");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(abilities(), "the search narrows the list").toEqual(["Find person"]);
    expect(page.textContent, "no category or sign-in facts, they are noise").not.toContain("your account, API key");
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
    expect(line.textContent).toContain("Attio is set up on Composio: click create auth config there, pick Attio, then check again.");
    expect(line.querySelector("a")?.getAttribute("href")).toBe("https://dashboard.composio.dev/~/project/auth-configs");
    expect(line.textContent).not.toContain("open settings");
    expect(dialog().textContent, "no dead-end toast").not.toContain("has no Composio-managed sign-in");
    const again = page.querySelector<HTMLButtonElement>(".ca-primary")!;
    expect(again.textContent).toContain("check again");
    made = true;
    await act(async () => { again.click(); });
    await flush();
    expect(fixture.opened.at(-1)).toBe("https://connect.example/attio");
    expect(dialog().querySelector("[data-composio-setup]")).toBeNull();
  });

  describe("connect asks for a Composio key right here", () => {
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
      const own = [...dialog().querySelectorAll<HTMLButtonElement>("[data-composio-key] button")].find((element) => element.textContent === "use an API key instead");
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
      expect(step.textContent).toContain("Attio connects through your own free Composio account. You only do this once.");
      expect(step.querySelectorAll("[data-guide-step]"), "one button, no numbered steps").toHaveLength(0);
      expect(step.querySelector("[data-composio-sign-in]")?.textContent, "the one button signs in to Composio").toContain("sign in to Composio");
      expect(dialog().querySelectorAll("[data-app-page] .ca-primary").length, "one main action on the page").toBe(1);
      await act(async () => { [...step.querySelectorAll("button")].find((element) => element.textContent === "use an API key instead")!.click(); });
      expect([...step.querySelectorAll(".ca-guide-text")].map((item) => item.textContent), "one short line per step").toEqual([
        "Open Composio's website.", "Copy your key from the keys page.", "Paste it here. We check it right away.",
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
    const primary = () => dialog().querySelector<HTMLButtonElement>("[data-app-page] [data-connect] .ca-primary");
    const shownLabel = () => primary()?.querySelector("span:not([aria-hidden])")?.textContent;
    const keyCard = () => dialog().querySelector("[data-app-page] [data-composio-key]");
    const line = () => dialog().querySelector("[data-via-line] > span:last-child")?.textContent;
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

    it("Composio once, then the app: the one-time step shows until Composio is saved, then Attio is just its own sign-in", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        keep();
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        let connected = false;
        const state = { signedIn: false, enabled: false as boolean | undefined };
        viaApi(state, (method) => method === "POST" ? { status: "started", url: "https://connect.composio.dev/link/ln_attio" } : { status: connected ? "connected" : "waiting" });
        expect(shownLabel(), "the first time, the one button signs in to Composio").toBe("sign in to Composio");
        expect(keyCard()?.querySelector("svg[shape-rendering=crispEdges], [data-pixel-state]"), "no art on the one-time step").toBeNull();
        await act(async () => { primary()!.click(); });
        await flush();
        expect(fixture.api).toHaveBeenCalledWith("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name: "composio-connect", type: "http", url: "https://connect.composio.dev/mcp", enabled: false }) });
        expect(fixture.api).not.toHaveBeenCalledWith("/api/config", expect.anything());
        expect(fixture.opened, "step two waits for its own click").toEqual([]);
        expect(keyCard(), "Composio is saved: its card never shows again").toBeNull();
        expect(shownLabel()).toBe("connect Attio");
        await act(async () => { primary()!.click(); });
        await flush();
        expect(fixture.api).toHaveBeenCalledWith("/api/connectors/composio-connect/apps/attio", expect.objectContaining({ method: "POST" }));
        expect(fixture.opened).toEqual(["https://connect.composio.dev/link/ln_attio"]);
        expect(shownLabel()).toBe("open page again");
        expect(line()).toBe("Finish signing in on Composio's page. This updates by itself.");
        await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
        expect(fixture.api, "waiting only reads").toHaveBeenCalledWith("/api/connectors/composio-connect/apps/attio", expect.objectContaining({ method: "GET" }));
        expect(fixture.api.mock.calls.filter(([path, init]) => path === "/api/connectors/composio-connect/apps/attio" && init?.method === "POST")).toHaveLength(1);
        connected = true;
        await act(async () => { window.dispatchEvent(new Event("focus")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(line()).toBe("Connected. Your bots can use Attio now.");
        expect(primary(), "connected: nothing left to click").toBeNull();
        expect(dialog().querySelector("[data-app-page] .ca-detail-header .ca-added")?.textContent).toContain("connected");
        expect(fixture.api, "on for bots").toHaveBeenCalledWith("/api/mcp/servers/composio-connect", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
        expect(dialog().textContent, "a short confirmation").toContain("added Attio");
        await act(async () => { button("back")!.click(); });
        expect(dialog().querySelector('#ca-section-connected')?.closest("section")?.querySelector('[data-app-row="attio"]')?.textContent, "in the Connected group").toContain("connected");
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

    it("Composio saved once: any Composio app is then a normal connect, with no key and no Composio step", async () => {
      await remount({ kind: "home" }, "unavailable");
      viaApi({ signedIn: true }, (method) => method === "POST" ? { status: "started", url: "https://connect.composio.dev/link/ln_asana" } : { status: "none" });
      await remountAt(7);
      for (const slug of ["attio"]) {
        expect(dialog().querySelector(`[data-app-page='${slug}'] [data-composio-key]`), "no one-time step once Composio is saved").toBeNull();
        expect(dialog().querySelector(`[data-app-page='${slug}'] input`), "no key or token to type").toBeNull();
        expect(shownLabel()).toBe("connect Attio");
      }
    });

    it("the first time, the one-time Composio step runs inline and goes straight on to the app's own sign-in on the desktop app", async () => {
      const opened: string[] = [];
      vi.stubGlobal("duskDesktop", { openExternal: async (url: string) => { opened.push(url); } });
      (window as unknown as { duskDesktop?: unknown }).duskDesktop = { openExternal: async (url: string) => { opened.push(url); } };
      try {
        keep();
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        const state = { signedIn: false, enabled: false as boolean | undefined };
        viaApi(state, (method) => method === "POST" ? { status: "started", url: "https://connect.composio.dev/link/ln_attio" } : { status: "waiting" });
        expect(dialog().querySelector("[data-composio-key]"), "the one-time step shows right here").not.toBeNull();
        await act(async () => { primary()!.click(); });
        await flush();
        await flush();
        expect(fixture.api, "one click: Composio, then the app").toHaveBeenCalledWith("/api/connectors/composio-connect/apps/attio", expect.objectContaining({ method: "POST" }));
        expect([...opened, ...fixture.opened], "the app's sign-in opens with no second click").toContain("https://connect.composio.dev/link/ln_attio");
      } finally {
        delete (window as unknown as { duskDesktop?: unknown }).duskDesktop;
      }
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
        expect(shownLabel()).toBe("retry");
      });

      it("the sign-in page is closed before the app connects: cancelled, Retry", async () => {
        await waitingThen(() => ({ status: "waiting" }), 0);
        fixture.closed = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
        expect(line()).toBe("The sign-in page closed before Attio connected.");
        expect(shownLabel()).toBe("retry");
      });

      it("coming back without finishing says so and keeps waiting", async () => {
        await waitingThen(() => ({ status: "waiting" }), 0);
        await act(async () => { window.dispatchEvent(new Event("focus")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(line()).toBe("Not connected yet. If you closed Composio's page, open it again.");
        expect(shownLabel()).toBe("open page again");
      });

      it("the Composio sign-in expired: authorize again", async () => {
        await waitingThen(() => { throw new ApiError("Composio sign-in expired. Authorize Composio again.", 409, { code: "composio_connect_signed_out" }); }, 2_100);
        expect(line()).toBe("Your Composio sign-in expired. Authorize Composio again.");
        expect(shownLabel()).toBe("authorize again");
        expect(keyCard(), "back to the one-time card").not.toBeNull();
      });

      it("Dusk restarting or the network down: says so and keeps trying, then connects", async () => {
        let down = true;
        await waitingThen(() => { if (down) throw new TypeError("Failed to fetch"); return { status: "connected" }; }, 2_100);
        expect(line()).toBe("can't reach Composio right now. trying again…");
        down = false;
        await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
        expect(line()).toBe("Connected. Your bots can use Attio now.");
      });

      it("never reachable until the link expires: offline, Retry", async () => {
        await waitingThen(() => { throw new ApiError("Couldn't reach Composio.", 502, { code: "composio_unreachable" }); }, 10 * 60_000 + 20_000);
        expect(line()).toBe("Couldn't reach Composio for a while. Check your connection and retry.");
        expect(shownLabel()).toBe("retry");
      });

      it("Composio refuses: its own words, Retry", async () => {
        keep();
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        viaApi({ signedIn: true }, (method) => method === "POST" ? { status: "failed", message: "Toolkit attio is not enabled" } : { status: "none" });
        await remountAt(7);
        await act(async () => { primary()!.click(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(line()).toBe("Composio couldn't connect Attio: Toolkit attio is not enabled");
        expect(shownLabel()).toBe("retry");
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
        expect(shownLabel()).toBe("retry");
      });

      it("a reload mid sign-in picks the wait up again", async () => {
        const kept = keep();
        kept.set("dusk.composioConnect.pending", JSON.stringify({ attio: { url: "https://connect.composio.dev/link/ln_attio", since: Date.now() - 60_000 } }));
        await remount({ kind: "detail", id: "attio" }, "unavailable");
        viaApi({ signedIn: true }, () => ({ status: "waiting" }));
        await remountAt(8);
        expect(shownLabel()).toBe("open page again");
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
        expect(shownLabel()).toBe("connect Attio");
        expect(line()).toBeUndefined();
        expect(JSON.parse(kept.get("dusk.composioConnect.pending") ?? "{}")).toEqual({});
      });

      it("Cancel stops the wait at once and says Connect again", async () => {
        await waitingThen(() => ({ status: "waiting" }), 0);
        expect(shownLabel()).toBe("open page again");
        const cancel = dialog().querySelector<HTMLButtonElement>("[data-app-page] [data-connect] [data-cancel]")!;
        expect(cancel.textContent).toBe("cancel");
        await act(async () => { cancel.click(); });
        expect(shownLabel()).toBe("connect Attio");
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
        expect(shownLabel()).toBe("waiting for Composio…");
        await act(async () => { window.dispatchEvent(new Event("blur")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
        expect(shownLabel(), "away on the sign-in page: still waiting").toBe("waiting for Composio…");
        await act(async () => { window.dispatchEvent(new Event("focus")); });
        await act(async () => { await vi.advanceTimersByTimeAsync(76_000); });
        expect(line()).toBe("Composio wasn't authorized. Try again.");
        expect(shownLabel()).toBe("retry");
        expect(fixture.api, "the sign-in is called off").toHaveBeenCalledWith("/api/mcp/servers/composio-connect/sign-in/f1", { method: "DELETE" });
      });
    });

    it("a key Composio refuses says so in one line and connects nothing", async () => {
      await remount({ kind: "detail", id: "attio" }, "unavailable");
      await paste("ak_bad");
      expect(dialog().querySelector("[data-composio-key] [role=alert] > span")?.textContent).toBe("Composio didn't accept that key. Copy it again from API keys.");
      expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/attio/authorize", expect.anything());
      await paste("not a key");
      expect(dialog().querySelector("[data-composio-key] [role=alert] > span")?.textContent).toBe("Composio keys start with ak_. Copy it again from API keys.");
    });

    it("with the managed broker, an app it cannot sign in to asks for the person's own key instead of a dead end", async () => {
      await remount({ kind: "detail", id: "attio" }, "managed");
      await act(async () => { dialog().querySelector<HTMLButtonElement>("[data-app-page] .ca-primary")!.click(); });
      await flush();
      expect(fixture.opened, "no Composio tab the broker could not use").toEqual([]);
      expect(dialog().querySelector("[data-composio-key]")?.textContent).toContain("Attio connects through your own free Composio account.");
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

  it("says Reconnect, not Connect, for a token app whose sign-in was refused, and opens its page ready to sign in in its place", async () => {
    const stale = { id: "a1a1a1a1a1a1a1a1", app: "trello", label: "Acme board", server: "trello", via: "token", connectedAt: "2026-11-13T00:00:00Z", needsReconnect: true };
    const base = fixture.api.getMockImplementation()!;
    fixture.api.mockImplementation(async (path: string, init?: unknown) => (path === "/api/app-tokens" ? { accounts: [stale], native: {} } : base(path, init)));
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "home" }, nonce: 3, onClose, onTemplates: vi.fn() })); });
    await flush();
    const row = dialog().querySelector<HTMLElement>('[data-app-row="trello"]')!;
    expect(row.querySelector(".ca-row-subtitle")?.textContent).toBe("needs reconnecting");
    const pill = row.querySelector<HTMLButtonElement>(".ca-pill")!;
    expect(pill.textContent).toContain("reconnect");
    await act(async () => { pill.click(); });
    await flush();
    const page = dialog().querySelector("[data-token-app='trello']")!;
    expect(page.querySelector("[data-needs-reconnect]")?.textContent).toBe("needs reconnecting");
    expect(page.querySelector("[data-guide-step='paste'] input"), "a new token goes in its place").not.toBeNull();
  });

  it("folds a token app's token into its one other-ways toggle when it can also sign in", async () => {
    const base = fixture.api.getMockImplementation()!;
    fixture.api.mockImplementation(async (path: string, init?: unknown) => (path === "/api/app-tokens" ? { accounts: [], native: { trello: true } } : base(path, init)));
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "detail", id: "trello" }, nonce: 4, onClose, onTemplates: vi.fn() })); });
    await flush();
    const page = () => dialog().querySelector("[data-token-app='trello']")!;
    expect(page().querySelector("[data-guide-step='sign-in']"), "the sign-in leads").not.toBeNull();
    expect([...dialog().querySelectorAll("button")].filter((one) => /instead/.test(one.textContent ?? "")), "no second switch").toHaveLength(0);
    const toggles = dialog().querySelectorAll<HTMLButtonElement>("[data-other-ways] > button");
    expect(toggles).toHaveLength(1);
    await act(async () => { toggles[0]!.click(); });
    const row = dialog().querySelector<HTMLElement>("[data-ways] [data-way='token']")!;
    expect(row.querySelector("span")?.textContent).toBe("your own token");
    await act(async () => { row.querySelector<HTMLButtonElement>(".ca-pill")!.click(); });
    expect(page().querySelector("[data-guide-step='paste'] input"), "the token steps take over").not.toBeNull();
    expect(dialog().querySelector("[data-ways] [data-way='token'] span")?.textContent, "and the sign-in waits behind the toggle").toBe("sign in with Trello");
  });

  it("lists accounts as grok does: disconnect asks again in place, then removes it", async () => {
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="slack"] .ca-row-open')!.click(); });
    await flush();
    const row = () => dialog().querySelector("[data-account='ca_1']")!;
    expect(row().textContent).toContain("linked account");
    expect(dialog().querySelector("[data-accounts]")?.textContent).toContain("add account");
    await act(async () => { row().querySelector<HTMLButtonElement>('[aria-label^="disconnect"]')!.click(); });
    expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/slack/accounts/ca_1", expect.anything());
    const confirm = row().querySelector<HTMLButtonElement>('[aria-label="confirm disconnecting linked account"]')!;
    expect(confirm.textContent).toBe("confirm disconnect");
    await act(async () => { confirm.click(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/connectors/slack/accounts/ca_1", { method: "DELETE" });
  });

  it("lists our 1Password and Composio's as one row, and its page leads with Composio since ours is not one click", async () => {
    expect(dialog().querySelectorAll('[data-app-row="1password"]')).toHaveLength(1);
    expect(dialog().querySelector('[data-app-row="_1password"]'), "composio's listing folds into ours").toBeNull();
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="1password"] .ca-row-open')!.click(); });
    await flush();
    expect(dialog().querySelector("[data-native-host]")?.className, "our vault card waits under the other ways").toBe("hidden");
    const toggle = dialog().querySelector<HTMLButtonElement>("[data-other-ways] > button")!;
    expect(toggle.textContent).toBe("other ways to connect");
    await act(async () => { toggle.click(); });
    const ways = [...dialog().querySelectorAll("[data-ways] [data-way]")];
    expect(ways.map((way) => [way.getAttribute("data-way"), way.querySelector("span")?.textContent])).toEqual([
      ["own", "share a vault (built in)"],
    ]);
    await act(async () => { ways[0]!.querySelector<HTMLButtonElement>(".ca-pill")!.click(); });
    expect(dialog().querySelector("[data-native-host]")?.className, "picking it opens our card").toBe("ca-native-host");
    await act(async () => { dialog().querySelector<HTMLButtonElement>("[data-connect] .ca-primary")!.click(); });
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
    expect(dialog().querySelector('[data-app-row="asana"]')?.textContent).not.toContain("connected");
    await act(async () => { answerCatalog({ configured: true, mode: "self-hosted", setup: "ready", source: "api", cards: [...CARDS].reverse() }); });
    await act(async () => { answerStatus({ services: { ...fixture.connected, asana: { connected: true, accounts: [{ id: "ca_2", status: "ACTIVE" }] } }, authoritative: true }); });
    await flush();
    expect(rows(), "no row moves or appears").toEqual(first);
    expect(titles()).toEqual(sections);
    expect(dialog().querySelector('[data-app-row="asana"]')?.textContent, "the badge updates in place").toContain("connected");
  });

  it("adds any MCP server from the Custom MCP row", async () => {
    const custom = dialog().querySelector('[data-app-row="custom-mcp"]')!;
    expect(custom.textContent).toContain("custom MCP");
    await act(async () => { custom.querySelector<HTMLButtonElement>(".ca-pill")!.click(); });
    expect(dialog().querySelector("[data-detail-hero-title]")?.textContent).toBe("custom MCP");
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
