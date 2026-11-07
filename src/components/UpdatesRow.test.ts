// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { UpdaterState } from "@/types/ogb";
import { UpdatesRow } from "./AppSettingsRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); delete (window as { ogb?: unknown }).ogb; });

function mount() {
  let publish!: (state: UpdaterState) => void;
  const check = vi.fn(async () => {});
  (window as { ogb?: unknown }).ogb = { updater: {
    onState: (listener: (state: UpdaterState) => void) => { publish = listener; listener({ status: "idle" } as UpdaterState); return () => {}; },
    check, install: vi.fn(),
  } };
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(UpdatesRow)));
  return { container, root, check, publish: (state: UpdaterState) => act(() => publish(state)) };
}

it("says the app is up to date after a check that finds nothing, then settles back", () => {
  vi.useFakeTimers();
  const { container, root, check } = mount();
  expect(container.textContent).not.toContain("You're up to date");
  act(() => container.querySelector("button")!.click());
  expect(check).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("You're up to date");
  act(() => { vi.advanceTimersByTime(3000); });
  expect(container.textContent).not.toContain("You're up to date");
  act(() => root.unmount());
});

it("waits for a slow check to finish before saying so", () => {
  vi.useFakeTimers();
  const { container, root, publish } = mount();
  act(() => container.querySelector("button")!.click());
  publish({ status: "checking" } as UpdaterState);
  act(() => { vi.advanceTimersByTime(5000); });
  expect(container.textContent).not.toContain("You're up to date");
  publish({ status: "idle" } as UpdaterState);
  expect(container.textContent).toContain("You're up to date");
  act(() => root.unmount());
});
