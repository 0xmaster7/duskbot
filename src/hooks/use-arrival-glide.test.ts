// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const animate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("motion/react", async (original) => ({ ...await original<typeof import("motion/react")>(), animate }));

import { useArrivalGlide } from "./use-paced-arrivals";

const OPENED = 1_800_000_000_000;
let root: Root;
let column: HTMLDivElement;
let height = 400;

function Probe({ last }: { last: { id: string; at: number } }) {
  useArrivalGlide({ current: column }, last, true, OPENED);
  return null;
}
const draw = (last: { id: string; at: number }) => act(() => root.render(createElement(Probe, { last })));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  animate.mockClear();
  column = document.createElement("div");
  Object.defineProperty(column, "offsetHeight", { configurable: true, get: () => height });
  height = 400;
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));

describe("useArrivalGlide", () => {
  it("lands a chat that just opened, or its history, in place", () => {
    draw({ id: "old-1", at: OPENED - 60_000 });
    // switching to another chat, or its history arriving: a new last row from before the chat opened
    height = 700;
    draw({ id: "old-2", at: OPENED - 30_000 });
    expect(animate).not.toHaveBeenCalled();
  });

  it("glides the column for a row that arrives while the chat is open", () => {
    draw({ id: "old-1", at: OPENED - 60_000 });
    height = 460;
    draw({ id: "live-1", at: OPENED + 1_000 });
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
