import { afterEach, expect, it, vi } from "vitest";
import { PRESENCE_BEAT_MS, reportPresence } from "./presence";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("says the app is open, keeps saying so, and says away when it goes to the background", async () => {
  vi.useFakeTimers();
  const said: boolean[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init: RequestInit) => { said.push(JSON.parse(String(init.body)).away); return new Response("{}"); }));
  let pause!: () => void, resume!: () => void;
  const doc = { visibilityState: "visible" as DocumentVisibilityState, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const stop = reportPresence({ onPause: (listener) => { pause = listener; return () => {}; }, onResume: (listener) => { resume = listener; return () => {}; } }, doc);
  expect(said).toEqual([false]);
  await vi.advanceTimersByTimeAsync(PRESENCE_BEAT_MS * 2);
  expect(said).toEqual([false, false, false]);
  pause();
  pause();
  await vi.advanceTimersByTimeAsync(PRESENCE_BEAT_MS * 2);
  expect(said).toEqual([false, false, false, true]);
  resume();
  expect(said).toEqual([false, false, false, true, false]);
  stop();
  await vi.advanceTimersByTimeAsync(PRESENCE_BEAT_MS * 2);
  expect(said).toHaveLength(5);
  expect(doc.removeEventListener).toHaveBeenCalled();
});
