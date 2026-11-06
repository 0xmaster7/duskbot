import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Bot } from "@/state/store";
import { GroupAvatar, groupCells } from "./GroupAvatar";

const bots = ["Quill", "Echo", "Nova", "Moss"].map((name) => ({
  id: name.toLowerCase(), name, color: "green", threadId: name, title: "", description: "", notifications: true, unread: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
}) as Bot);
const cells = (markup: string) => [...markup.matchAll(/data-group-avatar-cell="(\w+)"/g)].map((match) => match[1]);

describe("a group's avatar", () => {
  it("lays four faces in grok's 2x2 of 20px cells 16px apart in a 36px slot", () => {
    expect(groupCells(4, 36)).toEqual([{ x: 0, y: 0, size: 20 }, { x: 16, y: 0, size: 20 }, { x: 0, y: 16, size: 20 }, { x: 16, y: 16, size: 20 }]);
    expect(groupCells(3, 36)).toEqual([{ x: 8, y: 0, size: 20 }, { x: 0, y: 16, size: 20 }, { x: 16, y: 16, size: 20 }]);
    expect(groupCells(2, 36)).toEqual([{ x: 0, y: 0, size: 24 }, { x: 12, y: 12, size: 24 }]);
  });

  it("puts the person first, then up to three bots, with no count chip", () => {
    const markup = renderToStaticMarkup(createElement(GroupAvatar, { members: bots, size: 36, you: { initials: "AR" } }));
    expect(cells(markup)).toEqual(["you", "bot", "bot", "bot"]);
    expect(markup).toContain(">AR<");
    expect(markup).not.toContain("+1");
  });

  it("cuts a ring only where a later face overlaps", () => {
    const markup = renderToStaticMarkup(createElement(GroupAvatar, { members: bots, size: 36, you: { initials: "AR" } }));
    expect(markup.match(/(?<!-webkit-)mask-image:/g)?.length).toBe(3);
  });

  it("draws the bots alone when nobody is signed in", () => {
    expect(cells(renderToStaticMarkup(createElement(GroupAvatar, { members: bots.slice(0, 2), size: 36, you: null })))).toEqual(["bot", "bot"]);
  });
});
