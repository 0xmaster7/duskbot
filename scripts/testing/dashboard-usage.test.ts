// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardProvider } from "../../dashboard/src/data/store";
import { UsagePage } from "../../dashboard/src/pages/Usage";

vi.mock("../../dashboard/src/ui/Mascot", () => ({ BotMark: () => null, EmptyState: () => null, useReducedMotion: () => true }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.history.replaceState(null, "", "/usage");
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 700 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect() {}
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([[2027, 1, 28], [2028, 1, 29], [2026, 10, 30], [2026, 2, 31]])(
  "keeps the forecast on the final calendar day for %i/%i (%i days)",
  (year, month, lastDay) => {
    vi.spyOn(Date, "now").mockReturnValue(new Date(year, month, 8, 12).getTime());
    act(() => root.render(createElement(DashboardProvider, null, createElement(UsagePage))));
    const chart = host.querySelector<SVGSVGElement>('svg[aria-label^="Daily cost"]')!;
    expect(chart).not.toBeNull();
    const texts = [...chart.querySelectorAll("text")];
    const text = (value: string) => texts.find((node) => node.textContent === value)!;
    expect(text("Per day").classList.contains("fill-accent")).toBe(true);
    expect(text("Month to date").classList.contains("fill-ink-2")).toBe(true);

    const cap = texts.find((node) => node.textContent?.startsWith("AI cap"))!;
    const capLine = chart.querySelector('line[stroke-dasharray="4 4"]')!;
    expect(Number(cap.getAttribute("x"))).toBeGreaterThan(Number(capLine.getAttribute("x2")));

    const forecast = chart.querySelector('path[stroke-dasharray="1.5 3.5"]')!;
    const points = forecast.getAttribute("d")!.match(/[ML]([^,]+),[^ML]+/g)!;
    const finalX = Number(points.at(-1)!.slice(1).split(",")[0]);
    expect(points).toHaveLength(lastDay - 8 + 1);
    expect(finalX).toBeCloseTo(Number(text(String(lastDay)).getAttribute("x")), 1);
    expect(texts.filter((node) => Number(node.getAttribute("y")) > 200).at(-1)?.textContent).toBe(String(lastDay));

    act(() => chart.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(chart.parentElement!.querySelector("p")?.textContent).toBe("8");
  },
);
