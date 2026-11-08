import { describe, expect, it } from "vitest";
import { keepClear } from "./SkyScene";

const W = 390, H = 844;
const back = { left: 16, top: 62, right: 60, bottom: 106 };
const tile = { left: 139, top: 280, right: 251, bottom: 392 };

describe("keepClear", () => {
  it("leaves a mascot alone when nothing is in the way", () => {
    expect(keepClear(300, 160, 30, [back, tile], W, H)).toEqual({ x: 300, y: 160 });
  });

  it("moves a mascot off the back button by the shortest way out", () => {
    const spot = keepClear(40, 90, 26, [back], W, H);
    const overlaps = spot.x + 26 > back.left - 14 && spot.x - 26 < back.right + 14 && spot.y + 26 > back.top - 14 && spot.y - 26 < back.bottom + 14;
    expect(overlaps).toBe(false);
  });

  it("clears every rect, not only the first one it met", () => {
    const below = { left: 0, top: 393, right: W, bottom: 560 };
    const spot = keepClear(195, 330, 30, [tile, below], W, H);
    for (const r of [tile, below]) {
      expect(spot.x + 30 > r.left - 14 && spot.x - 30 < r.right + 14 && spot.y + 30 > r.top - 14 && spot.y - 30 < r.bottom + 14).toBe(false);
    }
  });
});

describe("keepClear margins", () => {
  it("keeps further off a top-bar control than off content", () => {
    const bar = { ...back, margin: 36 };
    const spot = keepClear(80, 84, 26, [bar], W, H);
    expect(spot.x - 26 >= bar.right + 36 || spot.y - 26 >= bar.bottom + 36 || spot.y + 26 <= bar.top - 36 || spot.x + 26 <= bar.left - 36).toBe(true);
  });
});
