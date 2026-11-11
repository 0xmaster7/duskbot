import { describe, expect, it, vi } from "vitest";
import { followSystemTextSize, textScaleFor } from "./text-scale";

describe("system text size", () => {
  it("is the system body size over its default, kept inside what the layout holds", () => {
    expect(textScaleFor(17)).toBe(1);
    expect(textScaleFor(19)).toBe(1.12);
    expect(textScaleFor(14)).toBe(0.9);
    expect(textScaleFor(28)).toBe(1.35);
    expect(textScaleFor(53)).toBe(1.35);
    expect(textScaleFor(Number.NaN)).toBe(1);
    expect(textScaleFor(0)).toBe(1);
  });

  it("sets the page's text zoom on an iPhone, and again when the app comes back", () => {
    let size = 21;
    const zoom = vi.fn();
    let resumed: (() => void) | undefined;
    const stop = vi.fn();
    expect(followSystemTextSize({ kind: "ios", onResume: (listener) => { resumed = listener; return stop; } }, () => size, zoom)).toBe(stop);
    expect(zoom).toHaveBeenLastCalledWith(124);
    size = 17;
    resumed?.();
    expect(zoom).toHaveBeenLastCalledWith(100);
  });

  it("leaves Android and the browser to their own text zoom", () => {
    const zoom = vi.fn();
    followSystemTextSize({ kind: "android" }, () => 30, zoom);
    followSystemTextSize({ kind: "web" }, () => 30, zoom);
    expect(zoom).not.toHaveBeenCalled();
  });
});
