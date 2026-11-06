import { describe, expect, it } from "vitest";

import { ROW_PITCH, rowWindow } from "./WindowedRows";

describe("which rows of a long list are drawn", () => {
  it("draws the rows in view and a few either side, never past the ends", () => {
    expect(rowWindow(300, 2, 0, 660)).toEqual({ first: 0, last: 14, columns: 2 });
    // scrolled 50 rows down: the list's top is 50 rows above the scroller's
    expect(rowWindow(300, 2, -50 * ROW_PITCH, 660)).toEqual({ first: 46, last: 64, columns: 2 });
    expect(rowWindow(300, 2, -1000 * ROW_PITCH, 660)).toEqual({ first: 150, last: 150, columns: 2 });
    expect(rowWindow(7, 1, 2000, 660), "a list below the fold draws nothing yet").toEqual({ first: 0, last: 0, columns: 1 });
  });
});
