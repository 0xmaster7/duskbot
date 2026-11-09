// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { fixtureCatalog } from "./fixtures";
import { priceCart } from "./pricing";
import type { Selection } from "./contracts";

// the live path: fixture mode marks every cart ready, which hid a selection rebuilt each render
const quote = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({ FIXTURE: null, api: { quote } }));
const { useCart } = await import("./quote");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); quote.mockReset(); });

test("a selection rebuilt on every render still gets one quote and becomes ready", async () => {
  vi.useFakeTimers();
  const base: Selection = { license: "personal", members: 1, desktop: fixtureCatalog.bundles[0]!.desktop, size: null, region: fixtureCatalog.regions[0]!.id, interval: "month" };
  quote.mockImplementation(async (selection: Selection) => priceCart(selection, fixtureCatalog));
  const seen: boolean[] = [];
  function Probe() {
    const { ready } = useCart({ ...base }, fixtureCatalog);
    seen.push(ready);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const rerender = () => root.render(createElement(Probe));
  await act(async () => { rerender(); });
  await act(async () => { rerender(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  await act(async () => { rerender(); await vi.advanceTimersByTimeAsync(200); });
  expect(seen.at(-1)).toBe(true);
  expect(quote).toHaveBeenCalledTimes(1);
  await act(async () => { root.unmount(); });
});
