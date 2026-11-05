import { describe, expect, it } from "vitest";

import { widenedBounds, windowBackground, windowChromeOptions } from "./window-chrome.mjs";

describe("window chrome", () => {
  it("uses inset traffic lights on macOS", () => {
    expect(windowChromeOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 7 },
    });
  });

  it("hides the native title bar on Windows; caption buttons are renderer-drawn", () => {
    expect(windowChromeOptions("win32")).toEqual({
      titleBarStyle: "hidden",
    });
  });

  it("keeps Linux window chrome native", () => {
    expect(windowChromeOptions("linux")).toEqual({});
  });

  it("with the frame turned off, opens macOS's traffic lights where the frame-less window keeps them, and gives Windows its own title bar back", () => {
    expect(windowChromeOptions("darwin", false)).toEqual({ titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 15 } });
    expect(windowChromeOptions("win32", false), "the system's title bar and caption buttons").toEqual({});
    expect(windowChromeOptions("linux", false)).toEqual({});
  });

  it("paints the light or dark canvas before the renderer loads", () => {
    expect(windowBackground(true)).toBe("#121212");
    expect(windowBackground(false)).toBe("#fcfcfc");
  });

  it("widens the window for the bot's panel within its screen, sliding left at the screen's edge", () => {
    const workArea = { x: 0, y: 25, width: 1440, height: 875 };
    expect(widenedBounds({ contentBounds: { x: 100, y: 40, width: 900, height: 700 }, workArea, deltaWidth: 84, minWidth: 512 }))
      .toEqual({ contentBounds: { x: 100, y: 40, width: 984, height: 700 }, applied: 84 });
    expect(widenedBounds({ contentBounds: { x: 600, y: 40, width: 900, height: 700 }, workArea, deltaWidth: 84, minWidth: 512 }).contentBounds.x).toBe(456);
    expect(widenedBounds({ contentBounds: { x: 0, y: 40, width: 1400, height: 700 }, workArea, deltaWidth: 84, minWidth: 512 }).applied, "no wider than the screen").toBe(40);
  });
});
