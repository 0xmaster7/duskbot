// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PACE_FIRST_MS, PACE_GAP_MS, usePacedArrivals } from "./use-paced-arrivals";

type Row = { id: string; role: "user" | "bot"; at: number; quiet?: boolean };
const NOW = 1_800_000_000_000;
let shown: string[] = [];
let held: string[] = [];
function Probe({ rows, keyName = "t" }: { rows: Row[]; keyName?: string }) {
  const paced = usePacedArrivals(keyName, rows, (row) => row.role === "bot" && !row.quiet);
  shown = paced.shown.map((row) => row.id);
  held = paced.held.map((row) => row.id);
  return null;
}
let root: Root;
const draw = (rows: Row[], keyName?: string) => act(() => root.render(createElement(Probe, { rows, keyName })));
const bot = (id: string, at = NOW): Row => ({ id, role: "bot", at });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ now: NOW });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("paced arrivals", () => {
  it("draws what was there on open at once", () => {
    draw([{ id: "u", role: "user", at: NOW }, bot("a"), bot("b")]);
    expect(shown).toEqual(["u", "a", "b"]);
  });

  it("brings live replies in one at a time, in order, a short beat apart", () => {
    draw([{ id: "u", role: "user", at: NOW }]);
    draw([{ id: "u", role: "user", at: NOW }, bot("a"), bot("b"), bot("c")]);
    expect(shown).toEqual(["u"]);
    expect(held).toEqual(["a", "b", "c"]);
    act(() => void vi.advanceTimersByTime(PACE_FIRST_MS[1]));
    expect(shown).toEqual(["u", "a"]);
    act(() => void vi.advanceTimersByTime(PACE_GAP_MS[1]));
    expect(shown).toEqual(["u", "a", "b"]);
    act(() => void vi.advanceTimersByTime(PACE_GAP_MS[1]));
    expect(shown).toEqual(["u", "a", "b", "c"]);
  });

  it("never holds the person's own message, and never draws it ahead of replies before it", () => {
    draw([{ id: "u", role: "user", at: NOW }]);
    draw([{ id: "u", role: "user", at: NOW }, bot("a"), bot("b")]);
    draw([{ id: "u", role: "user", at: NOW }, bot("a"), bot("b"), { id: "u2", role: "user", at: NOW }]);
    expect(shown).toEqual(["u", "a", "b", "u2"]);
  });

  it("draws quiet rows and old rows at once, and starts over in another conversation", () => {
    draw([bot("a")]);
    draw([bot("a"), { ...bot("q"), quiet: true }, bot("old", NOW - 60_000)]);
    expect(shown).toEqual(["a", "q", "old"]);
    draw([bot("x"), bot("y")], "other");
    expect(shown).toEqual(["x", "y"]);
  });
});
