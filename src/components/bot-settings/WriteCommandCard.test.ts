import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

vi.mock("./BotEditorContext", () => ({ useBotEditor: () => ({ request: vi.fn() }) }));

const { WriteCommandCard } = await import("./WriteCommandCard");

describe("WriteCommandCard", () => {
  it("offers a name, a description, and instructions with an {input} hint, and starts unsaveable", () => {
    const markup = renderToStaticMarkup(createElement(WriteCommandCard, { bot: { id: "b1" } as Bot, taken: [], onSaved: () => {} }));
    expect(markup).toContain("write a command");
    expect(markup).toContain('aria-label="command name"');
    expect(markup).toContain('aria-label="what it does"');
    expect(markup).toContain('aria-label="instructions"');
    expect(markup).toContain("{input}");
    expect(markup).toMatch(/<button type="submit" disabled=""[^>]*>Save command<\/button>/);
  });
});
