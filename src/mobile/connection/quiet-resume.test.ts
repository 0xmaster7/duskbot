import { afterEach, expect, it, vi } from "vitest";
import { QUIET_RESUME_MS, watchQuietResume } from "./quiet-resume";

afterEach(() => { vi.useRealTimers(); });

it("stays quiet for five seconds after each resume", () => {
  vi.useFakeTimers();
  let resume!: () => void;
  const states: boolean[] = [];
  const doc = { visibilityState: "visible" as DocumentVisibilityState, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const stop = watchQuietResume({ onResume: (listener) => { resume = listener; return () => {}; } }, (on) => states.push(on), doc);
  resume();
  expect(states).toEqual([true]);
  vi.advanceTimersByTime(QUIET_RESUME_MS - 1);
  resume();
  vi.advanceTimersByTime(QUIET_RESUME_MS - 1);
  expect(states).toEqual([true, true]);
  vi.advanceTimersByTime(1);
  expect(states).toEqual([true, true, false]);
  stop();
  expect(doc.removeEventListener).toHaveBeenCalled();
});
