import { describe, expect, it } from "vitest";
import { imageRowWidth, planImageLayout, planImageRow } from "./ImageRow";

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

describe("many pictures stack into justified rows", () => {
  const photo = { width: 1600, height: 1200 };
  const shape = (plan: ReturnType<typeof planImageLayout>) => plan.rows.map((row) => `${row.widths.length}@${row.height}`).join(" ");
  const span = (widths: number[]) => widths.reduce((total, width) => total + width, 0) + (widths.length - 1) * 6;

  it("keeps grok's single row up to three pictures and whenever every picture fits", () => {
    expect(shape(planImageLayout([photo, photo, photo], 560))).toBe("3@136");
    expect(shape(planImageLayout(Array(4).fill({ width: 900, height: 1200 }), 560))).toBe("4@181");
  });

  it("splits 4 to 9 photos into rows that fill the width exactly", () => {
    const shapes = [4, 5, 6, 7, 8, 9].map((count) => shape(planImageLayout(Array(count).fill(photo), 560)));
    expect(shapes).toEqual(["2@192 2@192", "2@192 3@137", "3@137 3@137", "4@102 3@137", "2@192 3@137 3@137", "3@137 3@137 3@137"]);
    for (const row of planImageLayout(Array(7).fill(photo), 560).rows) expect(span(row.widths)).toBe(560);
  });

  it("shows nine tiles at most and folds the rest into +N on the last", () => {
    const plan = planImageLayout(Array(12).fill(photo), 560);
    expect(plan.rows.reduce((total, row) => total + row.widths.length, 0)).toBe(9);
    expect(plan.folded).toBe(4);
    expect(planImageLayout(Array(9).fill(photo), 560).folded).toBe(0);
  });

  it("never upscales small pictures past their own height", () => {
    const plan = planImageLayout(Array(9).fill({ width: 120, height: 80 }), 560);
    expect(plan.rows.every((row) => row.height <= 80)).toBe(true);
  });
});
