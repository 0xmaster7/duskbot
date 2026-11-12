import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, BrowserProfile } from "@/state/store";

const fixture = vi.hoisted(() => ({ profiles: [] as BrowserProfile[], bots: [] as Bot[], myChrome: true, engine: undefined as Record<string, unknown> | undefined }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  ApiError: class extends Error {},
  useStore: () => ({
    state: { config: { browserProfiles: fixture.profiles, browserEngine: fixture.engine ?? { kind: "engine", myChrome: fixture.myChrome } }, bots: fixture.bots },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(),
  }),
}));
import { BrowserProfilesManager } from "./BrowserProfilesManager";
import { SubPageContext } from "./ListRows";

// Settings' list of shared profiles, and one profile's own page
const list = () => renderToStaticMarkup(createElement(BrowserProfilesManager));
const page = (id = "work") => renderToStaticMarkup(createElement(SubPageContext.Provider,
  { value: { at: `profile:${id}`, open: () => {}, back: () => {} } }, createElement(BrowserProfilesManager)));

const bot = { id: "pepper", name: "Pepper", browserProfile: "work" } as Bot;
beforeEach(() => {
  fixture.profiles = [{ id: "work", name: "Work", partitionId: "LegacyWork" }];
  fixture.bots = [bot, { id: "scout", name: "Scout", browserProfile: "work" } as Bot];
  fixture.myChrome = true;
  fixture.engine = undefined;
});

describe("browser profile manager", () => {
  it("renders on the web without an Electron bridge and never exposes internal partition ids", () => {
    const html = list();
    expect(html).toContain("new profile");
    expect(html).toContain('data-panel-page="profile:work"');
    expect(html).toContain("Work");
    expect(html).toContain("used by Pepper, Scout");
    expect(html).not.toContain("LegacyWork");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<input");
  });

  it("offers own, shared and temporary sessions without changing the current selection", () => {
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain('value="">own browser</option>');
    expect(html).toContain('value="work" selected="">Work</option>');
    expect(html).toContain('value="guest"');
    expect(html).toContain("bots on a shared profile use the same logins.");
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html.match(/<select[^>]*>/)?.[0]).toContain('disabled=""');
  });

  it("explains busy bot restrictions and deletion effects in accessible controls", () => {
    fixture.bots = [{ ...bot, busy: true }];
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain("stop this bot&#x27;s turn before switching browser profiles.");
    expect(html).toContain('aria-label="delete Work"');
    expect(html).toContain("Pepper is still running.");
    expect(html).toContain('maxLength="40"');
  });

  it("keeps a disappeared selection explicit instead of silently displaying another login", () => {
    fixture.profiles = [];
    const html = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(html).toContain("this profile was removed.");
    expect(html).toContain('value="work" disabled="" selected=""');
    expect(html).toContain("each bot still has its own browser.");
  });

  it("offers each profile Built-in or My Chrome, and lists a built-in profile's signed-in sites with who shares them", () => {
    expect(list()).toContain("built-in");
    const html = page();
    expect(html).toMatch(/role="combobox"[^>]*aria-label="browser"[\s\S]*?built-in/);
    expect(html).toContain("signed-in sites");
    expect(html).toContain("Pepper, Scout share this browser: signing out here signs all of them out.");
    expect(html).not.toContain("act inside your real Chrome");
  });

  it("says plainly that a My Chrome profile's bots act in the person's real, signed-in Chrome", () => {
    fixture.profiles = [{ id: "work", name: "Work", browser: "chrome" }];
    const html = page();
    expect(html).toMatch(/role="combobox"[^>]*aria-label="browser"[\s\S]*?my Chrome/);
    expect(html).toContain("bots on this profile act inside your real Chrome, signed in as you");
    expect(html).toContain("chrome://inspect/#remote-debugging");
    expect(html).not.toContain("signed-in sites");
    const botHtml = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot }));
    expect(botHtml).toContain("act inside your real Chrome");
  });

  it("says on Cloud and servers that My Chrome does not apply, and keeps the built-in browser", () => {
    fixture.myChrome = false;
    fixture.profiles = [{ id: "work", name: "Work", browser: "chrome" }];
    expect(list()).toContain("my Chrome is for the desktop app, where bots run on your own computer. anywhere else, such as the cloud, there is no Chrome of yours to use, so every profile uses the built-in browser.");
    const html = page();
    expect(html).not.toContain("act inside your real Chrome");
    expect(html).toContain("signed-in sites");
  });

  it("lists the bot's own browser's sites, shared by nobody, and none for a temporary browser", () => {
    fixture.bots = [{ ...bot, browserProfile: undefined }];
    const own = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot: fixture.bots[0] }));
    expect(own.match(/signed-in sites/g)).toHaveLength(2);
    expect(own).not.toContain("share this browser");
    fixture.bots = [{ ...bot, browserProfile: "guest" }];
    const guest = renderToStaticMarkup(createElement(BrowserProfilesManager, { bot: fixture.bots[0] }));
    expect(guest.match(/signed-in sites/g)).toHaveLength(1);
  });
});
