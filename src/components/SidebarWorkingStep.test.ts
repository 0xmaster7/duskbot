import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ value: { ended: false, status: null } as Record<string, unknown> }));
vi.mock("@/state/turn-status", () => ({ useTurnLive: () => live.value }));

import { SidebarWorkingStep, useWorkingLabel } from "./SidebarWorkingStep";

const bot = { threadId: "trip", tasks: [{ threadId: "trip", title: "Trip", createdAt: 1, busy: true }] };
const Label = ({ working }: { working: boolean }) => useWorkingLabel(bot, working) ?? "none";

describe("the bot's own status label", () => {
  it("is what a working row says when the bot set one, and nothing otherwise", () => {
    live.value = { ended: false, status: { activity: "thinking" }, label: "  is drafting the itinerary " };
    expect(renderToStaticMarkup(createElement(Label, { working: true }))).toBe("is drafting the itinerary");
    expect(renderToStaticMarkup(createElement(Label, { working: false }))).toBe("none");
    expect(renderToStaticMarkup(createElement(SidebarWorkingStep, { bot }))).toContain(">is drafting the itinerary</span>");
    live.value = { ended: false, status: { activity: "thinking" }, label: " " };
    expect(renderToStaticMarkup(createElement(Label, { working: true }))).toBe("none");
    expect(renderToStaticMarkup(createElement(SidebarWorkingStep, { bot }))).not.toContain("drafting");
  });
});
