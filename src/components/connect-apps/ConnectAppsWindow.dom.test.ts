// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  opened: [] as string[],
  connected: { slack: { connected: true, accounts: [{ id: "ca_1", status: "ACTIVE" }] } } as Record<string, unknown>,
  dispatch: vi.fn(),
  bundled: {
    source: "test", count: 2,
    toolkits: [
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
  connectorStatusMemory: () => null,
  rememberConnectorStatus: () => {},
  preloadConnectedApps: async () => ({ services: fixture.connected, authoritative: true }),
}));
vi.mock("@/lib/connector-oauth", async (original) => ({
  ...await original<typeof import("@/lib/connector-oauth")>(),
  reserveConnectionPage: () => ({ open: async (url: string) => { fixture.opened.push(url); return true; }, cancel: () => {} }),
}));
vi.mock("@/lib/connector-poll", () => ({ pollConnector: () => () => {} }));
vi.mock("@/lib/logins", () => ({ listLogins: async () => ({ logins: [], onePassword: { connected: false } }) }));
vi.mock("@/lib/mcp-servers", () => ({ loadMcpServers: async () => [] }));
vi.mock("../McpServersPanel", () => ({ McpServersPanel: () => null }));
vi.mock("../XCard", () => ({ XCard: () => null }));
vi.mock("../EmailCard", () => ({ EmailCard: () => null }));
vi.mock("../HighLevelCard", () => ({ HighLevelCard: () => null }));
vi.mock("../PostizCard", () => ({ PostizCard: () => null }));
vi.mock("../PluginsPanel", () => ({ botsUsingService: () => [], connectorSetupNotice: () => null, disconnectAccountConfirmation: () => ({ title: "", body: "", confirmLabel: "" }) }));

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
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  fixture.opened = [];
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
    expect(titles()[0]).toBe("Recommended for you");
    expect(titles()).toContain("Password Managers");
    expect(dialog().querySelector('[data-app-row="slack"]')?.textContent).toContain("Connected");
    expect(dialog().querySelector('[data-app-row="outlook"] .ca-pill')?.getAttribute("aria-label")).toBe("Connect Outlook");
    expect(dialog().querySelector('[data-app-row="outlook"] .ca-row-subtitle')?.textContent, "each row says what its app does, as grok's do").toBeTruthy();
  });

  it("shows one category from its chip and goes back to All from it again", async () => {
    await act(async () => { button("Design")!.click(); });
    expect(titles()).toEqual(["Design"]);
    expect(button("Design")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button("Design")!.click(); });
    expect(titles()[0]).toBe("Recommended for you");
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

  it("with the managed broker says the project's key goes in Settings too", async () => {
    act(() => root.unmount());
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/connectors/catalog") return { configured: true, mode: "managed", setup: "ready", source: "api", cards: CARDS };
      if (path === "/api/connectors/attio/authorize") throw new ApiError(managedCustomAuthReason("attio"), 409, { error: managedCustomAuthReason("attio") });
      return { services: {} };
    });
    const { loadConnectorCatalog } = await import("./use-connectors");
    await loadConnectorCatalog();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "detail", id: "attio" }, nonce: 3, onClose, onTemplates: vi.fn() })); });
    await flush();
    await act(async () => { dialog().querySelector<HTMLButtonElement>("[data-app-page] .ca-primary")!.click(); });
    await flush();
    expect(fixture.opened).toEqual(["https://dashboard.composio.dev/~/project/auth-configs"]);
    const line = dialog().querySelector("[data-composio-setup]")!;
    expect(line.textContent).toContain("add that project's key in Settings, then check again.");
    await act(async () => { [...line.querySelectorAll("button")].find((element) => element.textContent === "Open settings")!.click(); });
    expect(onClose).toHaveBeenCalled();
  });

  it("without a broker or a key still lists the whole catalog, and Connect leads to the Composio key in Settings", async () => {
    act(() => root.unmount());
    fixture.api.mockImplementation(async (path: string) => path === "/api/connectors/catalog"
      ? { configured: false, mode: "unavailable", setup: "needs-setup", source: "curated", cards: [card("slack", "Slack", "Communication")] }
      : { services: {} });
    const { loadConnectorCatalog } = await import("./use-connectors");
    await loadConnectorCatalog();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(createElement(ConnectAppsWindow, { page: { kind: "home" }, nonce: 2, onClose, onTemplates: vi.fn() })); });
    await flush();
    expect(dialog().querySelector('[data-app-row="attio"]')).not.toBeNull();
    expect(dialog().querySelector('[data-app-row="slack"]')).not.toBeNull();
    await act(async () => { dialog().querySelector<HTMLButtonElement>('[data-app-row="attio"] .ca-pill')!.click(); });
    expect(fixture.api).not.toHaveBeenCalledWith("/api/connectors/attio/authorize", expect.anything());
    const connect = dialog().querySelector<HTMLButtonElement>("[data-app-page] .ca-primary")!;
    expect(connect.disabled).toBe(false);
    await act(async () => { connect.click(); });
    expect(onClose).toHaveBeenCalled();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "connections" });
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
