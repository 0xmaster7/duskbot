import { describe, expect, it } from "vitest";
import { imageRowWidth, planImageRow } from "./ImageRow";

describe("grok's image row", () => {
  it("caps the row at 560px, 80% of the transcript and 82px short of it", () => {
    expect(imageRowWidth(960)).toBe(560);
    expect(imageRowWidth(500)).toBe(400);
    expect(imageRowWidth(90)).toBe(8);
  });

  it("lays two screenshots out at 192px, as grok draws them", () => {
    expect(planImageRow([{ width: 1600, height: 1000 }, { width: 900, height: 1400 }], 560)).toEqual({ height: 192, widths: [307, 123], folded: 0 });
  });

  it("folds a fourth image into +2 on the third tile", () => {
    const sizes = [{ width: 1600, height: 1000 }, { width: 900, height: 1400 }, { width: 1200, height: 1200 }, { width: 2000, height: 600 }];
    expect(planImageRow(sizes, 560)).toEqual({ height: 169, widths: [270, 109, 169], folded: 2 });
  });

  it("keeps a small image at its own height and an unknown one at 4:3", () => {
    expect(planImageRow([{ width: 120, height: 80 }], 560)).toEqual({ height: 80, widths: [120], folded: 0 });
    expect(planImageRow([null], 560)).toEqual({ height: 192, widths: [256], folded: 0 });
  });
});
