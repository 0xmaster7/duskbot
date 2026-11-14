import { expect, test } from "vitest";
import type { StoredEvent } from "../analytics/sink.ts";
import { sharingOf } from "./sharing.ts";

const DAY = 86_400_000, NOW = Date.parse("2026-11-14T12:00:00Z");
let n = 0;
const ev = (install: string, daysAgo: number, name: string, props: StoredEvent["props"] = {}): StoredEvent =>
  ({ id: `e${++n}`, name, at: NOW - daysAgo * DAY, accountId: null, props, ctx: { install } });
const flip = (install: string, daysAgo: number, on: boolean, where: string) => ev(install, daysAgo, "app_action", { name: "usage_sharing", on, where });

test("counts current state per install and changes over 7 and 30 days by place", () => {
  const answer = sharingOf([
    ev("a", 1, "app_open"),
    ev("b", 20, "app_open"), flip("b", 20, false, "first_run"),
    ev("c", 10, "app_open"), flip("c", 10, false, "settings"), flip("c", 3, true, "settings"), ev("c", 3, "app_open"),
    ev("d", 40, "app_open"), flip("d", 40, false, "settings"),
    ev("e", 60, "app_open"),
  ], NOW);
  expect(answer.optedIn).toBe(2);
  expect(answer.optedOut).toBe(2);
  expect(answer.outShare).toBe(0.5);
  const [week, month] = answer.windows;
  expect(week).toMatchObject({ days: 7, enables: 1, disables: 0 });
  expect(month).toMatchObject({ days: 30, enables: 1, disables: 2, byPlace: { settings: { enables: 1, disables: 1 }, first_run: { enables: 0, disables: 1 } } });
});

test("no events reads as nobody, not a broken share", () => {
  expect(sharingOf([], NOW)).toMatchObject({ optedIn: 0, optedOut: 0, outShare: null });
});
