import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Bot } from "@/state/store";
import type { CalendarEventItem } from "../RoutineCalendarPage";
import { CalendarEventCard, cardLayout, HOUR_HEIGHT } from "./CalendarEventCard";

const hazel: Bot = {
  id: "hazel", threadId: "t", name: "Hazel", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "test" },
} as Bot;
const at = new Date(2026, 9, 29, 11, 31).getTime();
const commitCheck: CalendarEventItem = {
  kind: "routine", id: "next-streak", at, durationMinutes: 30, run: null,
  routine: {
    id: "streak", name: "Daily GitHub commit-streak check", prompt: "Check today's commits.", target: "bot", botId: hazel.id, runOn: "maus", enabled: true,
    schedule: { type: "interval", everyMinutes: 360 }, durationMinutes: 30, nextRunAt: at, createdAt: 0, updatedAt: 0,
  },
} as CalendarEventItem;
const lasting = (minutes: number): CalendarEventItem => ({ ...commitCheck, id: `next-streak-${minutes}`, durationMinutes: minutes } as CalendarEventItem);
const render = (item: CalendarEventItem) => renderToStaticMarkup(createElement(CalendarEventCard, {
  item, bots: [hazel], groups: [], compact: true, layout: { column: 0, columns: 1 }, onOpen: () => {},
}));
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("a calendar card's fit", () => {
  it("gives a 30-minute marker one line, a full hour two, and a quarter hour just the title", () => {
    expect(cardLayout((30 / 60) * HOUR_HEIGHT)).toBe("compact");
    expect(cardLayout(HOUR_HEIGHT)).toBe("roomy");
    expect(cardLayout((15 / 60) * HOUR_HEIGHT)).toBe("tiny");
  });

  it("draws a 30-minute automation as one line of title, status and time, with the rest on hover", () => {
    const html = render(commitCheck);
    expect(html).toContain('data-event-fit="compact"');
    expect(html).toContain('data-event-status="working"');
    const text = visibleText(html);
    expect(text).toContain("Daily GitHub commit-streak check");
    expect(text).not.toContain("Hazel");
    expect(text).not.toMatch(/Every/);
    expect(/title="([^"]*)"/.exec(html)?.[1]).toMatch(/^Daily GitHub commit-streak check · 11:31.* · Hazel · Every 6 hr$/);
  });

  it("keeps the second line for an hour-long automation, and only the title for a 15-minute one", () => {
    const hour = render(lasting(60));
    expect(hour).toContain('data-event-fit="roomy"');
    expect(visibleText(hour)).toMatch(/Daily GitHub commit-streak check .* · Hazel · Every 6 hr/);
    const quarter = render(lasting(15));
    expect(quarter).toContain('data-event-fit="tiny"');
    expect(visibleText(quarter)).toBe("Daily GitHub commit-streak check");
  });
});
