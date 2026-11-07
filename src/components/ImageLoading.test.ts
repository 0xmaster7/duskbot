// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ImageLoading } from "./ImageLoading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("an image's loading tile", () => {
  it("names the picture for a screen reader and holds still: no spinner, no pulse", () => {
    act(() => root.render(createElement(ImageLoading, { name: "chart.png", className: "absolute inset-0" })));
    const tile = host.querySelector<HTMLElement>("[role=status]")!;
    expect(tile.textContent).toBe("Loading chart.png");
    expect(tile.querySelector("svg")).toBeNull();
    expect(tile.className).not.toMatch(/animate-/);
  });
});
