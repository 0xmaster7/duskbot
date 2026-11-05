// @vitest-environment happy-dom
// A still mark in a real DOM: a re-render after its colour changed must not paint the first colour back.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GrokMark } from "./mascot-motion-view";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const paint = (ink: string, label: string) =>
  flushSync(() => root.render(createElement(GrokMark, { body: "tablet", ink, animated: false, size: 24, label })));

describe("GrokMark", () => {
  it("keeps its current colour through a re-render that changes nothing it draws", () => {
    paint("#111111", "Pepper");
    paint("#14c16f", "Pepper");
    expect(host.innerHTML).toContain("#14c16f");
    // the label is not drawn, so this render leaves the svg alone
    paint("#14c16f", "Pepper ");
    expect(host.innerHTML).toContain("#14c16f");
    expect(host.innerHTML).not.toContain("#111111");
  });
});
