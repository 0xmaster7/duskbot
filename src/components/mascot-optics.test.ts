import { describe, expect, it } from "vitest";

import { GROK_BODY_IDS } from "../../shared/grok-bodies";
import { MARK_OPTICS, OPTICAL_EXTENT, markOptics, measureMarkOptics, opticalTransform } from "./mascot-optics";

describe("mark optics", () => {
  it("matches what the engine draws for every body", () => {
    const measured = Object.fromEntries(GROK_BODY_IDS.map((body) => {
      const { scale, x, y } = measureMarkOptics(body);
      return [body, { scale, x, y }];
    }));
    expect(MARK_OPTICS).toEqual(measured);
  });

  it("draws the tall crystal, the wide heart and the small leaf at one optical size, at rest and at work", () => {
    for (const body of ["crystal", "heart", "leaf", "blob", "tablet", "sparkle"]) {
      const { rest, busy, scale } = measureMarkOptics(body);
      expect(Math.abs(rest * scale - OPTICAL_EXTENT)).toBeLessThan(5);
      expect(Math.abs(busy * scale - OPTICAL_EXTENT)).toBeLessThan(5);
    }
  });

  it("centres an off-centre rest pose and leaves unknown bodies alone", () => {
    expect(markOptics("wedge").x).toBeLessThan(0);
    expect(opticalTransform("wedge")).toMatch(/^translate\(-50%, -50%\) scale\(0\.858\) translate\(-8\.67%, -6\.17%\)$/);
    expect(opticalTransform("pumpkin-carved")).toBe("translate(-50%, -50%)");
  });
});
