import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Bot } from "@/state/store";
import { BotFaces } from "./BotFaces";

const bots = ["Quill", "Echo", "Nova", "Moss", "Rivet"].map((name) => ({
  id: name.toLowerCase(), name, color: "green", threadId: name, title: "", description: "", notifications: true, unread: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
}) as Bot);
const names = (markup: string) => [...markup.matchAll(/role="img" aria-label="([^"]+)"/g)].map((match) => match[1]);

describe("a room's faces", () => {
  it("draws three faces and counts the rest, at any size", () => {
    for (const size of [24, 52]) {
      const markup = renderToStaticMarkup(createElement(BotFaces, { members: bots, size }));
      expect(names(markup)).toEqual(["Quill", "Echo", "Nova"]);
      expect(markup).toMatch(/data-bot-faces-more=""[^>]*>\+(?:<!-- -->)?2</);
    }
  });

  it("puts the members at work first, playing their working state", () => {
    const markup = renderToStaticMarkup(createElement(BotFaces, { members: bots, size: 24, working: new Set(["rivet"]) }));
    expect(names(markup)).toEqual(["Rivet", "Quill", "Echo"]);
    expect(markup).toMatch(/data-state="working"[^>]*aria-label="Rivet"/);
  });

  it("draws no count while every member has a face", () => {
    expect(renderToStaticMarkup(createElement(BotFaces, { members: bots.slice(0, 3), size: 24 }))).not.toContain("data-bot-faces-more");
  });
});
