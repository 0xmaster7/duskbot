import { describe, expect, it } from "vitest";

import { KIT_BODY, KIT_EYES } from "../../electron/startup-mascot.mjs";
import { DUSK_BODY_IDS } from "../../shared/body-migration";
import { PIXEL_STATES, PixelCore, stillFrame, stillSvgPaths } from "./core";

describe("pixel still frames", () => {
  it("draws the splash's kit exactly as the engine does at rest", () => {
    const kit = stillSvgPaths("kit", { scale: 1 });
    expect(kit.body).toBe(KIT_BODY);
    expect(kit.eyes).toBe(KIT_EYES);
  });

  it("puts two eyes inside every body at every size the app draws", () => {
    for (const body of DUSK_BODY_IDS) for (const size of [16, 20, 24, 28, 32, 36, 44, 64, 96, 112]) {
      const { paint } = stillFrame(body, { size });
      expect(paint.includes(2), `${body} at ${size}`).toBe(true);
    }
  });

  it("finds a fitting face for every state on every body", () => {
    for (const body of DUSK_BODY_IDS) for (const state of PIXEL_STATES) {
      const bot = new PixelCore({ body, size: 24, state, calm: true, life: false });
      expect(bot.shown, `${body} ${state}`).not.toBe("partial");
    }
  });
});
