// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createShortcutHold, SHORTCUT_HOLD_MS, shortcutBadgeText } from "./SidebarShortcutHold";

const ids = Array.from({ length: 11 }, (_, index) => `b${index + 1}`);
const down = (key: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
const up = (key: string) => window.dispatchEvent(new KeyboardEvent("keyup", { key }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("numbers the first nine shown bots once ⌘ alone is held for half a second, and clears on release", () => {
  const hold = createShortcutHold("Meta", () => ids);
  const changed = vi.fn();
  const stop = hold.subscribe(changed);
  down("Meta", { metaKey: true });
  vi.advanceTimersByTime(SHORTCUT_HOLD_MS - 1);
  expect(hold.slot("b1")).toBeNull();
  vi.advanceTimersByTime(1);
  expect([hold.slot("b1"), hold.slot("b9"), hold.slot("b10")]).toEqual([1, 9, null]);
  down("2", { metaKey: true });
  expect(hold.slot("b2")).toBe(2);
  up("Meta");
  expect(hold.slot("b1")).toBeNull();
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
});

it("shows nothing for ⌘ with Shift, Option or Control, and lets go on blur", () => {
  const hold = createShortcutHold("Meta", () => ids);
  const stop = hold.subscribe(() => {});
  down("Meta", { metaKey: true });
  down("Shift", { metaKey: true, shiftKey: true });
  vi.advanceTimersByTime(SHORTCUT_HOLD_MS);
  expect(hold.slot("b1")).toBeNull();
  down("Meta", { metaKey: true });
  vi.advanceTimersByTime(SHORTCUT_HOLD_MS);
  expect(hold.slot("b1")).toBe(1);
  window.dispatchEvent(new Event("blur"));
  expect(hold.slot("b1")).toBeNull();
  stop();
});

it("writes ⌘ on a Mac and ⌃ elsewhere", () => {
  expect(shortcutBadgeText("Meta", 3)).toBe("⌘3");
  expect(shortcutBadgeText("Control", 3)).toBe("⌃3");
});
