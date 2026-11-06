import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { SendKey } from "@/lib/send-key";
import { en, locales } from "@/locales";
import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";
import { SettingsModal } from "./SettingsModal";

const fixture = vi.hoisted(() => ({
  section: "appearance" as AppSettingsSection,
  showThreads: true,
  setShowThreads: vi.fn(),
  showRunCard: true,
  setShowRunCard: vi.fn(),
  toolsLayout: "rows" as "rows" | "toolbar",
  setSidebarToolsLayout: vi.fn(),
  notificationSounds: true,
  setNotificationSounds: vi.fn(),
  setNotificationFeed: vi.fn(),
  sendKey: "enter" as SendKey,
  setSendKey: vi.fn(),
  colorUserBubbles: false,
  setColorUserBubbles: vi.fn(),
  advancedMode: false,
  setAdvancedMode: vi.fn(),
  api: vi.fn(),
  dispatch: vi.fn(),
  switches: [] as ComponentProps<typeof Switch>[],
  rail: null as { available: boolean; hidden: boolean } | null,
  railHidden: [] as boolean[],
}));
// The Cloud account card reads the host platform (what a saved sign-in still locked asks for).
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: { host: { platform: "darwin" } } }) }));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [], bots: [] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/thread-preferences", () => ({
  useShowThreads: () => fixture.showThreads,
  useShowThreadsChoice: () => fixture.showThreads,
  setShowThreads: fixture.setShowThreads,
}));
vi.mock("@/lib/run-card-preferences", () => ({
  useShowRunCard: () => fixture.showRunCard,
  setShowRunCard: fixture.setShowRunCard,
}));
vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarToolsLayout: () => fixture.toolsLayout,
  setSidebarToolsLayout: fixture.setSidebarToolsLayout,
}));
vi.mock("@/lib/notification-preferences", () => ({
  useNotificationSounds: () => fixture.notificationSounds,
  setNotificationSounds: fixture.setNotificationSounds,
  useNotificationFeed: () => false,
  setNotificationFeed: fixture.setNotificationFeed,
  useFinishedNotifications: () => true,
  setFinishedNotifications: vi.fn(),
}));
vi.mock("@/lib/send-key", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/send-key")>(),
  useSendKey: () => fixture.sendKey,
  setSendKey: fixture.setSendKey,
}));
vi.mock("@/lib/user-bubble-preference", () => ({
  useColorUserBubbles: () => fixture.colorUserBubbles,
  setColorUserBubbles: fixture.setColorUserBubbles,
}));
vi.mock("@/lib/interface-mode", () => ({
  useAdvancedMode: () => fixture.advancedMode,
  setAdvancedMode: fixture.setAdvancedMode,
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("./PeopleSection", () => ({ PeopleSection: () => null }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: () => null }));
vi.mock("@/lib/chrome-rail", () => ({ useChromeRail: () => fixture.rail, setChromeRailHidden: (hidden: boolean) => fixture.railHidden.push(hidden) }));
vi.mock("./SettingsPrimitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SettingsPrimitives")>();
  return {
    ...original,
    Switch: (props: ComponentProps<typeof Switch>) => {
      fixture.switches.push(props);
      return createElement(original.Switch, props);
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "appearance";
  fixture.showThreads = true;
  fixture.showRunCard = true;
  fixture.toolsLayout = "rows";
  fixture.notificationSounds = true;
  fixture.sendKey = "enter";
  fixture.colorUserBubbles = false;
  fixture.advancedMode = false;
  fixture.switches = [];
  fixture.rail = null;
  fixture.railHidden = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

const trigger = (html: string, label: string) => html.match(new RegExp(`role="combobox" aria-label="${label}"[^>]*>(?:<[^>]+>)*([^<]+)<`))?.[1];

describe("Settings → General → Appearance, and Advanced → Looks", () => {
  it("draws Grok's Appearance card: Theme, Accent and Language, with no Advanced mode switch", () => {
    fixture.section = "general";
    const html = render();
    expect(trigger(html, "Theme")).toBeTruthy();
    expect(trigger(html, "Accent")).toBe("Neutral");
    expect(trigger(html, "Language")).toBeTruthy();
    expect(html).not.toContain('aria-label="Advanced mode"');
  });

  it("shows the bot's colour as the Accent once chosen", () => {
    fixture.section = "general";
    fixture.colorUserBubbles = true;
    expect(trigger(render(), "Accent")).toBe("Bot color");
  });

  it("keeps the app language reachable from a paired remote client", () => {
    fixture.section = "general";
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain('aria-label="Language"');
    expect(html).not.toContain('aria-label="Advanced mode"');
  });

  it("has no Advanced mode switch in Builder Controls: there is one layout", () => {
    fixture.section = "builder";
    expect(render()).not.toContain('aria-label="Advanced mode"');
  });

  it("groups skins, pins and tool-call display in Looks, with no dead thread or run card switches", () => {
    fixture.section = "looks";
    const html = render();
    expect(html).toContain('role="combobox" aria-label="Skin"');
    expect(html).not.toContain('aria-label="Show threads"');
    expect(html).not.toContain('aria-label="Show the run card"');
    expect(html).toContain('aria-label="Pinned bots as circles"');
    expect(html).toContain('aria-label="Universal pins"');
    expect(html).toContain('aria-label="Show tool calls in chat"');
    expect(html).not.toContain("from every group");
    expect(html).not.toContain("Group turn time limit");
  });

  it("keeps the switch for the window's rail of places with the sidebar's rows, where this window has one", () => {
    fixture.section = "looks";
    expect(render()).not.toContain("Show your computers");
    fixture.rail = { available: true, hidden: true };
    const html = render();
    const at = html.indexOf('aria-label="Show your computers"');
    expect(at).toBeGreaterThan(html.indexOf('aria-label="Chat width"'));
    expect(at).toBeLessThan(html.indexOf('aria-label="Pinned bots as circles"'));
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Show your computers")!;
    expect(toggle.checked).toBe(false);
    toggle.onClick!({} as never);
    expect(fixture.railHidden).toEqual([false]);
  });

  it.each([true, false])("mutes notification sounds on this computer only when the switch is %s", (enabled) => {
    fixture.section = "general";
    fixture.notificationSounds = enabled;
    const html = render();
    expect(html).toContain("Play Sound for Notifications");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Notification sounds")!;
    expect(toggle.checked).toBe(enabled);
    toggle.onClick!({} as never);
    expect(fixture.setNotificationSounds).toHaveBeenCalledWith(!enabled);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("has no choice of sidebar density: the sidebar's edge is dragged instead", () => {
    fixture.section = "looks";
    const html = render();
    expect(html).not.toContain("Sidebar density");
    expect(html).not.toContain(">Avatars only<");
  });

  it("drops the tools layout row, which only the removed Advanced mode read", () => {
    fixture.section = "looks";
    expect(render()).not.toContain("Tools layout");
  });

  it.each([
    ["enter", "Enter"],
    ["shift-enter", "Shift+Enter"],
    ["mod-enter", "Ctrl+Enter"],
  ] as const)("shows the saved send key (%s) in System, on this device only", (sendKey, label) => {
    fixture.section = "general";
    fixture.sendKey = sendKey;
    const html = render();
    expect(html).toContain("Send messages with");
    expect(trigger(html, "Send messages with")).toBe(label);
    expect(fixture.setSendKey).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("asks Japanese speakers in Japanese", () => {
    setLocale("ja");
    fixture.section = "general";
    fixture.sendKey = "shift-enter";
    const html = render();
    expect(html).toContain("メッセージの送信キー");
    expect(html).toContain(">Shift+Enter<");
  });

  it("offers the notification feed in Notifications, off until chosen", () => {
    fixture.section = "general";
    const html = render();
    expect(html).toContain("Notification feed");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Show the notification feed")!;
    expect(toggle.checked).toBe(false);
    toggle.onClick!({} as never);
    expect(fixture.setNotificationFeed).toHaveBeenCalledWith(true);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it.each([
    ["standard", "Standard"],
    ["wide", "Wide"],
    ["full", "Full width"],
  ])("shows the saved chat width (%s) in Looks", (width, label) => {
    fixture.section = "looks";
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "omb-chat-width" ? width : null });
    const html = render();
    expect(trigger(html, "Chat width")).toBe(label);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("keeps the builder controls together in Builder Controls, off the first screens", () => {
    fixture.section = "builder";
    const html = render();
    expect(html).toContain("Group turn time limit");
    expect(html).toContain("Tasks at once per bot");
    expect(html).toContain("Automatic recovery");
    fixture.section = "general";
    const general = render();
    for (const text of ["Group turn time limit", "Tasks at once per bot", "Automatic recovery", 'aria-label="Pinned bots as circles"', "Midnight"]) {
      expect(general, text).not.toContain(text);
    }
  });

  it("makes local looks available remotely without exposing server settings", () => {
    fixture.section = "looks";
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain('role="combobox" aria-label="Skin"');
    expect(html).toContain('aria-label="Pinned bots as circles"');
    expect(html).not.toContain('aria-label="Show tool calls in chat"');
    expect(html).not.toContain('data-settings-page="updates"');
    expect(html).not.toContain('data-settings-page="permissions"');
  });

  it("offers full backups in Privacy and Data", () => {
    fixture.section = "backups";
    const html = render();
    expect(html).toContain("Export full backup");
    expect(html).toContain('type="file" accept=".ombbackup"');
  });

  it("renders Looks and its controls in Japanese", () => {
    setLocale("ja");
    fixture.section = "looks";
    const html = render();
    for (const key of [
      "settings.section.appearance", "settings.pinnedCircles.title", "settings.universalPins.title",
    ] as const) {
      expect(locales.ja[key], key).toBeTruthy();
      expect(locales.ja[key], key).not.toBe(en[key]);
      expect(html, key).toContain(locales.ja[key]!);
    }
  });

  it("uses English fallback for new keys in an incomplete language pack", () => {
    locales.zz = {};
    try {
      setLocale("zz");
      fixture.section = "looks";
      const html = render();
      expect(html).toContain("Looks");
      expect(html).toContain('aria-label="Universal pins"');
      expect(html).not.toContain("settings.universalPins");
      expect(html).not.toContain("settings.advanced");
    } finally {
      delete locales.zz;
      setLocale("en");
    }
  });

  it("offers desktop connections on Computer, open, without exposing the list remotely", () => {
    fixture.section = "desktopWorkspaces";
    vi.stubGlobal("window", { ogb: { environments: {} } });
    const local = render();
    expect(local).toContain("Connect to a server");
    expect(local).toContain("Your servers");
    fixture.section = "computer";
    vi.stubGlobal("window", { ogb: { workspaces: {} } });
    expect(render()).not.toContain('data-settings-block="desktopWorkspaces"');
  });

  it("offers optional Organisation settings only through the local desktop bridge", () => {
    fixture.section = "organization";
    vi.stubGlobal("window", { ogb: { organization: {} } });
    expect(render()).toContain('data-panel-page="organization"');
    vi.stubGlobal("window", {});
    expect(render()).not.toContain('data-panel-page="organization"');
    vi.stubGlobal("window", { ogb: { organization: {}, remoteClient: { active: true } } });
    expect(render()).not.toContain('data-panel-page="organization"');
  });

  it("offers personal Cloud in Usage and Billing, only through the local desktop bridge", () => {
    fixture.section = "cloudAccount";
    vi.stubGlobal("window", { ogb: { cloudAccount: {} } });
    expect(render()).toContain("Free local use");
    vi.stubGlobal("window", {});
    expect(render()).not.toContain('data-settings-block="cloudAccount"');
  });
});
