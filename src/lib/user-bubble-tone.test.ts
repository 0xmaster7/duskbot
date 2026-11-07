import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color-contrast";
import { MAUS_COLORS, MAUS_COLOR_NAMES, type MausColor } from "./mascot";
import {
  BUBBLE_TOKEN_MIN,
  bothSchemes,
  grokFill,
  grokFills,
  mentionChipBackground,
  quoteSurface,
  userBubbleStyle,
  userBubbleTone,
  type Scheme,
} from "./user-bubble-tone";

/** Grok Bot's bubble fills (its palette's light /2 and dark /1 steps) for the hue each of our colours maps to. */
const GROK_BUBBLE: Record<MausColor, { light: string; dark: string }> = {
  green: { light: "#0d9655", dark: "#0e9f5a" },
  blue: { light: "#126fd4", dark: "#116dd2" },
  red: { light: "#c82532", dark: "#cf2b35" },
  orange: { light: "#d2550a", dark: "#cd5309" },
  purple: { light: "#7442d1", dark: "#7845d7" },
  cyan: { light: "#0d9381", dark: "#0e9886" },
  pink: { light: "#c82779", dark: "#cf297e" },
  yellow: { light: "#c2730b", dark: "#c8770c" },
  teal: { light: "#0d9381", dark: "#0e9886" },
  coral: { light: "#d2550a", dark: "#cd5309" },
  brown: { light: "#86592e", dark: "#8c5d31" },
  silver: { light: "#1c1c1c", dark: "#3b3b3b" },
  chrome: { light: "#1c1c1c", dark: "#3b3b3b" },
};

const SCHEMES: Scheme[] = ["light", "dark"];
const cases = MAUS_COLOR_NAMES.flatMap((color) => SCHEMES.map((scheme) => [color, scheme] as const));

describe("user bubble tone", () => {
  it.each(cases)("fills %s in %s with grok's own colour under white text", (color, scheme) => {
    const tone = userBubbleTone(color, scheme);
    expect(tone.background).toBe(GROK_BUBBLE[color][scheme]);
    expect(grokFill(color, scheme).bubble).toBe(GROK_BUBBLE[color][scheme]);
    expect(tone.ink).toBe("#ffffff");
    expect(tone.gradient).toBe("linear-gradient(rgb(255 255 255 / 0.06), transparent)");
  });

  it("keeps the colours the user complained about vivid: atlas orange and yellow stay grok's, never darkened or dark-inked", () => {
    expect(userBubbleTone("orange", "light")).toMatchObject({ background: "#d2550a", ink: "#ffffff" });
    expect(userBubbleTone("yellow", "light")).toMatchObject({ background: "#c2730b", ink: "#ffffff" });
    expect(MAUS_COLOR_NAMES.filter((color) => userBubbleTone(color).ink !== "#ffffff")).toEqual([]);
  });

  it("maps coral to grok's orange, the nearer of its orange and red", () => {
    expect(grokFills("coral")).toEqual(grokFills("orange"));
    expect(grokFills("teal")).toEqual(grokFills("cyan"));
    expect(grokFills("chrome")).toEqual(grokFills("silver"));
  });

  it.each(MAUS_COLOR_NAMES)("paints %s with css that follows the color-scheme, flat for Simple mode", (color) => {
    const light = userBubbleTone(color, "light");
    const dark = userBubbleTone(color, "dark");
    const tone = userBubbleTone(color);
    expect(tone.background).toBe(`light-dark(${light.background}, ${dark.background})`);
    for (const key of Object.keys(tone) as (keyof typeof tone)[]) expect(tone[key], key).toBe(bothSchemes(light[key], dark[key]));
    expect(tone.ink).toBe("#ffffff");
    const flat = userBubbleStyle(color, { flat: true }) as Record<string, unknown>;
    expect(flat.backgroundColor).toBe(tone.background);
    expect(flat.backgroundImage).toBe("none");
    expect(flat["--color-ink"]).toBe("#ffffff");
    expect(flat["--color-bubble-user-ink"]).toBe("#ffffff");
    expect((userBubbleStyle(color) as Record<string, unknown>).backgroundImage).toBe(tone.gradient);
  });

  it.each(cases)("keeps everything derived for %s in %s readable at 3:1 on grok's fill", (color, scheme) => {
    const tone = userBubbleTone(color, scheme);
    const fill = tone.background;
    const min = BUBBLE_TOKEN_MIN;
    expect(min).toBe(3);
    expect(contrastRatio(tone.ink, fill), "body").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.secondary, fill), "secondary").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.tertiary, fill), "tertiary").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.tertiary, fill)).toBeLessThanOrEqual(contrastRatio(tone.secondary, fill));
    expect(contrastRatio(tone.secondary, fill)).toBeLessThanOrEqual(contrastRatio(tone.ink, fill));
    expect(contrastRatio(tone.accent, fill), "link").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.danger, fill), "danger").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.success, fill), "success").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.hairline, fill), "hairline").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.focus, fill), "focus").toBeGreaterThanOrEqual(min);
    const quote = quoteSurface(tone.inset, fill);
    expect(contrastRatio(tone.accent, quote), "quote name").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.secondary, quote), "quote snippet").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.ink, tone.inset), "code").toBeGreaterThanOrEqual(contrastRatio(tone.ink, fill));
    expect(contrastRatio(tone.secondary, tone.inset), "code secondary").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.ink, tone.raised), "hover").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.ink, tone.raisedHover), "hover stronger").toBeGreaterThanOrEqual(min);
    expect(new Set([fill, tone.raised, tone.raisedHover]).size, "hover steps show").toBe(3);
    expect(contrastRatio(tone.accent, tone.raised), "link on hover").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.accentInk, tone.accent), "send").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.dangerInk, tone.danger), "danger fill").toBeGreaterThanOrEqual(min);
    expect(contrastRatio(tone.successInk, tone.success), "success fill").toBeGreaterThanOrEqual(min);
    expect(tone.selection).not.toBe(fill);
    expect(contrastRatio(tone.selectionInk, tone.selection), "selection").toBeGreaterThanOrEqual(min);
    for (const mention of MAUS_COLOR_NAMES) {
      const chip = mentionChipBackground(MAUS_COLORS[mention], tone.inset);
      expect(contrastRatio(tone.ink, chip), `mention ${mention}`).toBeGreaterThanOrEqual(min);
    }
  });
});
