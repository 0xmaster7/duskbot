import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { fitBounds, normalizeUnreadCount, parseWindowState, resolveWindowState, sameBounds } = require("./window-state.cjs");

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const left = { x: -1600, y: 0, width: 1600, height: 900 };

describe("desktop window state", () => {
  it("rejects corrupt and incomplete saved state", () => {
    expect(parseWindowState("not json")).toBeNull();
    expect(parseWindowState({ bounds: { x: 1, y: 2, width: 0, height: 700 } })).toBeNull();
    expect(parseWindowState({ bounds: { x: 1, y: 2, width: 1000 } })).toBeNull();
  });

  it("restores a reachable window on the display where it was saved", () => {
    expect(
      resolveWindowState(
        { bounds: { x: -1500, y: 40, width: 1200, height: 760 }, maximized: true },
        [primary, left],
      ),
    ).toEqual({ bounds: { x: -1500, y: 40, width: 1200, height: 760 }, maximized: true });
  });

  it("centers an off-screen window on the primary display and clamps its size", () => {
    expect(
      resolveWindowState(
        { bounds: { x: 7000, y: 7000, width: 4000, height: 200 }, maximized: false },
        [primary, left],
      ),
    ).toEqual({ bounds: { x: 0, y: 280, width: 1920, height: 520 }, maximized: false });
  });

  it("opens a first launch centred on the primary display, sized to fit it", () => {
    expect(resolveWindowState(null, [primary])).toEqual({
      bounds: { x: 440, y: 160, width: 1040, height: 760 },
      maximized: false,
    });
    const small = { x: 0, y: 25, width: 900, height: 600 };
    expect(resolveWindowState(null, [small, left])).toEqual({ bounds: { x: 0, y: 25, width: 900, height: 600 }, maximized: false });
  });

  it("pulls a window hanging off the left edge fully back onto its display", () => {
    expect(resolveWindowState({ bounds: { x: -300, y: 100, width: 1040, height: 760 } }, [primary]).bounds)
      .toEqual({ x: 0, y: 100, width: 1040, height: 760 });
    expect(fitBounds({ x: 1500, y: 900, width: 1040, height: 760 }, [primary])).toEqual({ x: 880, y: 320, width: 1040, height: 760 });
  });

  it("keeps a window whole after its display goes away or shrinks", () => {
    // was on the left display, now unplugged: centred on what is left
    expect(fitBounds({ x: -1500, y: 40, width: 1200, height: 760 }, [primary])).toEqual({ x: 360, y: 160, width: 1200, height: 760 });
    // the resolution dropped under the window: it shrinks to the work area, not under it
    const lower = { x: 0, y: 25, width: 1280, height: 775 };
    expect(fitBounds({ x: 600, y: 300, width: 1400, height: 900 }, [lower])).toEqual({ x: 0, y: 25, width: 1280, height: 775 });
    // never smaller than the window's minimum while the display has room
    expect(fitBounds({ x: 0, y: 25, width: 300, height: 200 }, [lower])).toEqual({ x: 0, y: 25, width: 768, height: 520 });
  });

  it("picks the display a window mostly sits on across several monitors", () => {
    const right = { x: 1920, y: -200, width: 2560, height: 1415 };
    expect(fitBounds({ x: 1800, y: -300, width: 1000, height: 700 }, [primary, left, right])).toEqual({ x: 1920, y: -200, width: 1000, height: 700 });
    expect(fitBounds({ x: 10, y: 10, width: 800, height: 600 }, [])).toBeNull();
    expect(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
    expect(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false);
  });

  it("bounds native unread counts", () => {
    expect(normalizeUnreadCount(-4)).toBe(0);
    expect(normalizeUnreadCount(3.9)).toBe(3);
    expect(normalizeUnreadCount(10_000)).toBe(999);
    expect(normalizeUnreadCount("3")).toBe(0);
  });
});
