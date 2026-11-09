// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CHANGE_MOTION_MS, useChangeMoment, useStill } from "./shared";
import type { AmbientBridge } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

it("a surface holds still on main's word, and a change still shows for a moment", async () => {
  vi.useFakeTimers();
  let tell: (still: boolean) => void = () => {};
  const bridge = { onStill: (cb: (still: boolean) => void) => { tell = cb; return () => {}; } } as unknown as AmbientBridge;
  const seen: Array<[boolean, boolean]> = [];
  function Probe({ status }: { status: string }) {
    seen.push([useStill(bridge), useChangeMoment(status)]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe, { status: "working" })));
  expect(seen.at(-1)).toEqual([false, false]);
  await act(async () => tell(true));
  expect(seen.at(-1)).toEqual([true, false]);
  await act(async () => root.render(createElement(Probe, { status: "needs-you" })));
  expect(seen.at(-1)).toEqual([true, true]);
  await act(async () => { vi.advanceTimersByTime(CHANGE_MOTION_MS); });
  expect(seen.at(-1)).toEqual([true, false]);
  await act(async () => root.unmount());
});
