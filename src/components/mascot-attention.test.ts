// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { ATTENTION, attentionGaze, watchPointer } from "./mascot-attention";

const rect = { left: 100, top: 100, width: 64, height: 64 };
const centre = { x: 132, y: 132 };

describe("pointer attention", () => {
  it("looks toward a pointer near the mark, y down, eased off by tanh and capped at 0.7", () => {
    const right = attentionGaze(rect, { x: centre.x + 80, y: centre.y })!;
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBe(0);
    expect(attentionGaze(rect, { x: centre.x, y: centre.y + 80 })!.y).toBeGreaterThan(0);
    const far = attentionGaze(rect, { x: centre.x + 190, y: centre.y })!;
    expect(far.x).toBeGreaterThan(right.x);
    expect(far.x).toBeLessThan(ATTENTION.strength);
    expect(attentionGaze(rect, centre)).toEqual({ x: 0, y: 0 });
  });

  it("ignores a pointer more than three mark widths away", () => {
    expect(attentionGaze(rect, { x: centre.x + 64 * 3 + 1, y: centre.y })).toBeNull();
    expect(attentionGaze({ ...rect, width: 0, height: 0 }, centre)).toBeNull();
  });

  it("shares one window listener, ignores touch, and forgets the pointer when it leaves", () => {
    const seen: Array<{ x: number; y: number } | null> = [];
    const stopA = watchPointer((point) => seen.push(point));
    const stopB = watchPointer(() => {});
    const move = (pointerType: string) => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 6, pointerType }));
    move("mouse");
    move("touch");
    window.dispatchEvent(new Event("blur"));
    expect(seen).toEqual([{ x: 5, y: 6 }, null, null]);
    stopA();
    stopB();
    move("mouse");
    expect(seen).toHaveLength(3);
  });
});
