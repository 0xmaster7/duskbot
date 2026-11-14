// The trap is module scope: the panes are listed once at import time, and a label resolved there would keep the boot
// language.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { en, locales } from "@/locales";
import { StoreProvider } from "@/state/store";

// No DOM here: the screen only asks whether the desktop bridge is there, so an empty window answers as a browser tab
// does.
beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= {};
  // The skin picker reads the attribute main.tsx stamps before first paint.
  (globalThis as { document?: unknown }).document ??= { documentElement: { dataset: {} } };
});

// Analytics (mocked below) boots PostHog on import, which wants a real browser.
vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
}));

vi.mock("./PeopleSection", () => ({ PeopleSection: () => null }));

async function renderSettings(): Promise<string> {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(SettingsModal)));
}

afterEach(() => {
  setLocale("en");
});

describe("settings → general", () => {
  it("renders in the language the picker selected, and re-renders in the next one", async () => {
    setLocale("pt-br");
    const pt = await renderSettings();
    expect(pt).toContain("Configurações");
    expect(pt).toContain('aria-label="Idioma"');

    // Same module instance, no reload: a frozen label would still say the Portuguese words here.
    setLocale("ja");
    const ja = await renderSettings();
    expect(ja).toContain("設定");
    for (const key of ["settings.section.general", "settings.group.account", "settings.section.appearance", "settings.language.title", "notifications.title"] as const) {
      expect(locales.ja[key], key).toBeTruthy();
      expect(locales.ja[key], key).not.toBe(en[key]);
      expect(ja, key).toContain(locales.ja[key]!);
    }
    expect(ja).not.toContain('aria-label="Idioma"');
  });

  it("stays English when no language is picked", async () => {
    setLocale("en");
    const html = await renderSettings();
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain(">General</h2>");
    expect(html).toContain('aria-label="Language"');
  });

  it("keeps the rail, which a phone shows as its own list of panes under a titled header", async () => {
    const html = await renderSettings();
    expect(html).toMatch(/<nav aria-label="Settings sections" class="settings-nav"><div class="settings-phone-head"><h2 class="settings-phone-title">Settings<\/h2><button type="button" aria-label="Close"/);
    expect(html).not.toContain('aria-label="Settings section"');
  });
});
