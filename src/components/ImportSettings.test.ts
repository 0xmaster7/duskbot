import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreContext } from "@/state/store";
import type { SetupDetection } from "../../shared/setup-import";
import { AiAppsImportView, ImportSettings, type AiAppsImportViewProps } from "./ImportSettings";

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const FOUND: SetupDetection = {
  skills: [{ name: "pdf", source: "claudeCode" }, { name: "review", source: "codex" }],
  tools: [{ name: "notion", source: "cursor" }],
};
const apps = (overrides: Partial<AiAppsImportViewProps> = {}) => text(renderToStaticMarkup(createElement(AiAppsImportView, {
  local: true, detection: FOUND, chosen: { skills: true, tools: true }, status: "idle", result: null, onChoose: vi.fn(), onBring: vi.fn(), ...overrides,
})));

describe("Settings → Import", () => {
  it("draws From your AI apps and the one button for moving from Grok Bot, and opens nothing until it is pressed", () => {
    vi.stubGlobal("window", { duskDesktop: { remoteClient: { active: false } } });
    const value = { state: { config: {} }, dispatch: vi.fn() } as never;
    const markup = renderToStaticMarkup(createElement(StoreContext.Provider, { value }, createElement(ImportSettings, {
      client: { detect: vi.fn(() => new Promise<SetupDetection>(() => {})), apply: vi.fn() },
    })));
    expect(markup).toContain('data-import-section="apps"');
    expect(markup).toContain('data-import-section="grok"');
    const shown = text(markup);
    expect(shown).toContain("from your AI apps");
    expect(shown).toContain("skills and tools from your other AI apps");
    expect(shown).toContain("move from Grok bot");
    expect(markup).toContain("data-grok-move-open");
    expect(markup).not.toContain("data-grok-move=");
    expect(markup.indexOf('data-import-section="apps"')).toBeLessThan(markup.indexOf('data-import-section="grok"'));
    vi.unstubAllGlobals();
  });

  it("leaves out From your AI apps where it cannot read this computer's apps", () => {
    vi.stubGlobal("window", {});
    const value = { state: { config: {} }, dispatch: vi.fn() } as never;
    const markup = renderToStaticMarkup(createElement(StoreContext.Provider, { value }, createElement(ImportSettings, {
      client: { detect: vi.fn(), apply: vi.fn() },
    })));
    expect(markup).not.toContain('data-import-section="apps"');
    expect(markup).toContain('data-import-section="grok"');
    vi.unstubAllGlobals();
  });

  it("offers the welcome step's rows, with its counts, sources and switched-off note", () => {
    const shown = apps();
    expect(shown).toContain("2 from Claude Code and Codex");
    expect(shown).toContain("1 MCP server from Cursor");
    expect(shown).toContain("added switched off.");
    expect(shown).toContain("bring them in");
  });

  it("says what happened: looking, nothing new, not this computer, or the result", () => {
    expect(apps({ detection: undefined })).toContain("looking on this computer…");
    expect(apps({ detection: { skills: [], tools: [] } })).toContain("nothing new to bring in from your AI apps.");
    expect(apps({ local: false })).toContain("only the desktop app on the computer running Dusk");
    expect(apps({ result: { skills: { added: ["pdf"], present: [], skipped: [], filesLeftOut: 0, review: [] } } })).toContain("added 1 skill.");
  });
});
