import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AppSettingsSection } from "@/state/store";
import { SETTINGS_PANES, SettingsModal, openSettings, settingsLocation } from "./SettingsModal";
import { ADVANCED_PAGES, TextingPane } from "./SettingsPanes";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  config: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  ownerOrAdmin: null as boolean | null,
  sounds: true,
  advancedMode: false,
}));

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async () => ({})),
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [], bots: [], config: fixture.config }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.ownerOrAdmin }));
vi.mock("@/lib/notification-preferences", () => ({
  useNotificationSounds: () => fixture.sounds,
  setNotificationSounds: vi.fn(),
  notificationSoundsEnabled: () => fixture.sounds,
  useFinishedNotifications: () => true,
  setFinishedNotifications: vi.fn(),
}));
const { marker } = vi.hoisted(() => ({ marker: (name: string) => () => `MARKER:${name};` }));
vi.mock("./EnginesSettings", () => ({ EnginesSettings: marker("engines") }));
vi.mock("./keys/KeysPage", () => ({ KeysPage: marker("apiKeys") }));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: marker("remoteClient") }));
vi.mock("./CompanionSection", () => ({ CompanionSection: marker("companion") }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: marker("pairing") }));
vi.mock("./ConnectedWorkspacesSettings", () => ({ ConnectedWorkspacesSettings: marker("desktopWorkspaces") }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: marker("computer") }));
vi.mock("./CloudAccountSettings", () => ({ CloudAccountSettings: marker("cloudAccount") }));
vi.mock("./OrganizationSettings", () => ({ OrganizationSettings: marker("organization") }));
vi.mock("./PeopleSection", () => ({ PeopleSection: marker("people") }));
vi.mock("./ActivitySection", () => ({ ActivitySection: marker("activity") }));
vi.mock("./UsageSection", () => ({ UsageSection: marker("usage") }));
vi.mock("./McpServersPanel", () => ({ McpServersPanel: marker("mcp") }));
vi.mock("./SkillsSection", () => ({ SkillsSection: marker("skills") }));
vi.mock("./LoginsSettings", () => ({ LoginsSettings: marker("logins"), VaultNewItem: () => null }));
vi.mock("./bot-access/AccessOverview", () => ({ AccessOverview: marker("botAccess") }));
vi.mock("./WorkspaceBackupSettings", () => ({ WorkspaceBackupSettings: marker("backups") }));
vi.mock("./CompanyBackupSettings", () => ({ CompanyBackupSettings: () => null }));
vi.mock("./ImportSettings", () => ({ ImportSettings: marker("import") }));
vi.mock("./RoomTurnTimeoutSettings", () => ({ RoomTurnTimeoutSettings: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "general";
  fixture.config = { features: { browser: false }, browserEngine: { kind: "bundled", installable: true }, composio: { mode: "self" } };
  fixture.ownerOrAdmin = null;
  fixture.sounds = true;
  fixture.advancedMode = false;
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), duskDesktop: { environments: {}, organization: {}, cloudAccount: {} } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn(), documentElement: { dataset: {} } });
  setLocale("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const open = (section: AppSettingsSection) => { fixture.section = section; return renderToStaticMarkup(createElement(SettingsModal)); };
const panes = (html: string) => [...html.matchAll(/data-settings-page="([^"]+)"/g)].map((match) => match[1]);
const current = (html: string) => html.match(/data-settings-page="([^"]+)" aria-current="page"/)?.[1];
const groups = (html: string) => [...html.matchAll(/<h3 id="[^"]*"[^>]*>([^<]+)<\/h3>/g)].map((match) => match[1]);
const markers = (html: string) => [...html.matchAll(/MARKER:([^;]+);/g)].map((match) => match[1]);
const title = (html: string) => html.match(/<h2 id="[^"]*" class="settings-pane-title[^"]*">([^<]+)<\/h2>/)?.[1];

describe("Settings, drawn as Grok Bot's", () => {
  it("rails Grok's panes with Phone and Models, then Advanced features last, and no Bots pane beside the bot panel", () => {
    const html = open("general");
    expect(panes(html)).toEqual(["general", "texting", "computer", "vault", "models", "usage", "updates", "advanced"]);
    expect(html).toContain('data-icon-name="vault"');
    expect(html).toContain('data-icon-name="chart-bars"');
    expect(html).toContain('data-icon-name="settings-gear"');
    expect(html).toContain('data-icon-name="cloud-download"');
    expect(current(html)).toBe("general");
    expect(title(html)).toBe("general");
  });

  it("opens General with bring your stuff first for someone new, then you, how it looks, typing and sending, notifications and data sharing", () => {
    const html = open("general");
    expect(groups(html)).toEqual(["bring your stuff", "you", "how it looks", "typing and sending", "notifications", "data sharing"]);
    expect(html).not.toContain("data-settings-fold");
    expect(html).toContain("bring in from other apps");
    // the import row names the apps it brings bots from; the Grok move itself lives on the import page
    expect(html).not.toContain("move from Grok bot");
    expect(markers(html)).toEqual([]);
    expect(html).toContain('data-panel-page="import"');
    expect(markers(open("import"))).toEqual(["import"]);
    for (const label of ["theme", "language"]) expect(html).toContain(`role="combobox" aria-label="${label}`);
    expect(html).toContain('role="radiogroup" aria-label="your message color"');
    expect(html).toContain("play sound for notifications");
    expect(html).toContain('aria-label="notification sound"');
    expect(html).toContain("open blip");
    expect(html).not.toContain("advanced mode");
  });

  it("hides the ping picker while notification sounds are off", () => {
    fixture.sounds = false;
    expect(open("general")).not.toContain('aria-label="notification sound"');
  });

  it("opens Advanced features on one titled group of its rarer pages, with no shortcuts to places the sidebar already has", () => {
    const html = open("advanced");
    expect(title(html)).toBe("advanced features");
    expect(groups(html)).toEqual(["everything else"]);
    expect([...html.matchAll(/data-settings-open="([^"]+)"/g)].map((match) => match[1])).toEqual([]);
    expect([...html.matchAll(/data-settings-advanced="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["apps", "team", "data"]);
    expect(markers(html)).toEqual([]);
    expect(html).not.toContain("data-settings-back");
  });

  it("opens an Advanced features page under it, with a way back", () => {
    const html = open("apps");
    expect(current(html)).toBe("advanced");
    expect(title(html)).toBe("apps and tools");
    expect(html).toContain('aria-label="back to advanced features"');
  });

  it("gives providers and keys their own Models pane, with Jev set up in the group chat instead", () => {
    const html = open("engines");
    expect(current(html)).toBe("models");
    expect(title(html)).toBe("models");
    expect(html).not.toContain("data-settings-back");
    expect(markers(html)).toEqual(["engines"]);
    expect(html).toContain('data-panel-page="keys"');
    expect(html).not.toContain('data-panel-page="decision"');
    expect(html).not.toContain('data-panel-page="recovery"');
    expect(markers(open("connections"))).toEqual(["apiKeys"]);
  });

  it("opens Usage & Billing as Grok's pane: the limits, an empty state when none report, then the plan", () => {
    const html = open("usage");
    expect(current(html)).toBe("usage");
    expect(title(html)).toBe("usage &amp; billing");
    expect(html).toContain("no usage limits to show");
    expect(html).toContain("usage breakdown");
    expect(markers(open("cloudAccount"))).toContain("cloudAccount");
  });

  it("homes the features Grok has no place for inside Advanced, and help under Updates", () => {
    expect(open("apps")).toContain('data-panel-page="mcp"');
    expect(current(open("about"))).toBe("updates");
    expect(open("about")).toContain('data-settings-open="shortcuts"');
    expect(current(open("looks"))).toBe("general");
    expect(open("looks")).toContain('data-settings-block="appearance"');
    expect(open("engines")).toContain('data-settings-block="bot-defaults"');
    expect(markers(open("backups"))).toEqual(["backups"]);
  });

  it("keeps how sending works on General, and who you are only on the account row", () => {
    expect(open("general")).toContain("sending while a bot works");
    const bots = open("bots");
    expect(bots).not.toContain("sending while a bot works");
    expect(bots).not.toContain('data-settings-block="profile"');
  });

  it("puts the phone on Phone, the bots' computer and servers on Computer, and logins in the Vault", () => {
    expect(markers(open("companion"))).toEqual(["pairing", "companion"]);
    expect(current(open("companion"))).toBe("texting");
    expect(open("computer")).toContain('data-panel-page="computers"');
    expect(markers(open("desktopWorkspaces"))).toContain("desktopWorkspaces");
    expect(markers(open("logins"))).toEqual(["logins"]);
    expect(current(open("logins"))).toBe("vault");
  });

  it("draws the pairing block and the phones on the pane itself, and nothing when there is no phone to pair", () => {
    const remoteAccess = { pairing: "PAIRING_BLOCK", companion: "PHONES", client: null };
    const without = renderToStaticMarkup(createElement(TextingPane, { has: (id) => id !== "companion", remoteAccess }));
    expect(without).toBe("");
    const paired = renderToStaticMarkup(createElement(TextingPane, { has: () => true, remoteAccess }));
    expect(paired.indexOf("PAIRING_BLOCK")).toBeLessThan(paired.indexOf("PHONES"));
    expect(paired).not.toContain("data-panel-page");
  });

  it("gives a team's admins Bot access on Permissions, and hides the pane when it would be empty", () => {
    expect(markers(open("botAccess"))).not.toContain("botAccess");
    expect(panes(open("general"))).not.toContain("permissions");
    fixture.config = { ...fixture.config, team: { name: "Acme" } };
    fixture.ownerOrAdmin = true;
    expect(open("permissions")).toContain('data-panel-page="botAccess"');
    expect(markers(open("botAccess"))).toContain("botAccess");
    expect(panes(open("general"))).toContain("permissions");
  });

  it("shows a paired remote client General, Texting and Computer, with its look in General", () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), duskDesktop: { remoteClient: { active: true }, environments: {} } });
    expect(panes(open("general"))).toEqual(["general", "texting", "computer"]);
    expect(groups(open("general"))).toEqual(["how it looks", "notifications"]);
    expect(current(open("looks"))).toBe("general");
    expect(current(open("engines"))).toBe("general");
  });


});

describe("where every section lives now", () => {
  const every: AppSettingsSection[] = [
    "general", "desktopWorkspaces", "organization", "cloudAccount", "appearance", "experimental", "connections", "engines",
    "companion", "remote", "computer", "logins", "usage", "people", "botAccess", "activity", "backups", "skills", "import", "updates",
    "texting", "permissions", "advanced", "apps", "looks", "bots", "data", "builder", "about",
  ];

  it("lands every old and new deep link on a pane, and Advanced's on a page", () => {
    for (const section of every) {
      const at = settingsLocation(section);
      expect(SETTINGS_PANES.some((pane) => pane.id === at.pane), section).toBe(true);
      if (at.pane === "advanced" && section !== "advanced") expect(ADVANCED_PAGES.find((page) => page.id === at.page)?.sections, section).toContain(section);
    }
    expect(settingsLocation("engines")).toEqual({ pane: "models" });
    expect(settingsLocation("usage")).toEqual({ pane: "usage" });
    expect(settingsLocation("companion")).toEqual({ pane: "texting" });
    expect(settingsLocation("logins")).toEqual({ pane: "vault" });
    expect(settingsLocation("import")).toEqual({ pane: "general" });
    expect(settingsLocation("appearance")).toEqual({ pane: "general" });
  });

  it("opens Settings at a pane, an Advanced page or a section", () => {
    expect(openSettings("permissions")).toEqual({ type: "toggleAppSettings", open: true, section: "permissions" });
    expect(openSettings("ai")).toEqual({ type: "toggleAppSettings", open: true, section: "engines" });
    expect(openSettings("billing")).toEqual({ type: "toggleAppSettings", open: true, section: "usage" });
    expect(openSettings("models")).toEqual({ type: "toggleAppSettings", open: true, section: "engines" });
    expect(openSettings("advanced")).toEqual({ type: "toggleAppSettings", open: true, section: "advanced" });
    expect(openSettings("logins")).toEqual({ type: "toggleAppSettings", open: true, section: "logins" });
    expect(openSettings()).toEqual({ type: "toggleAppSettings", open: true, section: "general" });
  });
});
