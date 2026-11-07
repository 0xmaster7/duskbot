// Fills the person's bubble with Grok Bot's own colour for the bot's hue, always under white text (grok's #f5f5f5 in dark).

import type { CSSProperties } from "react";
import { contrastRatio, mixSrgb, toOklch } from "./color-contrast";
import { MAUS_COLORS, type MausColor } from "./mascot";

const WHITE = "#ffffff";
const BLACK = "#000000";
const INK = "#101410";
const DARK_INK = "#f5f5f5";
/** Grok's fills do not all reach 4.5:1 under white (orange ~4:1, yellow ~3.6:1), so what we derive holds 3:1. */
export const BUBBLE_TOKEN_MIN = 3;

export const MENTION_CHIP_MIX = 0.22;
export const SELECTION_BLACK_MIX = 0.35;

export type Scheme = "light" | "dark";

export type GrokFill = { bubble: string; button: string; hover: string; ink: string; buttonInk: string };

type Steps = [bubble: string, button: string, hover: string];

/** Grok's palette for one hue, measured in its renderer: light /2 bubble, /1 button darkening to /2 on hover; dark /1
 * for both, brightening to /2. Text is white in light and grok's #f5f5f5 in dark. */
const hue = (light: Steps, dark: Steps, buttonInk = { light: WHITE, dark: DARK_INK }): Record<Scheme, GrokFill> => ({
  light: { bubble: light[0], button: light[1], hover: light[2], ink: WHITE, buttonInk: buttonInk.light },
  dark: { bubble: dark[0], button: dark[1], hover: dark[2], ink: DARK_INK, buttonInk: buttonInk.dark },
});

const GROK_HUES = {
  green: hue(["#0d9655", "#10ab61", "#0d9655"], ["#0e9f5a", "#0e9f5a", "#13bb6b"]),
  blue: hue(["#126fd4", "#1680f3", "#126fd4"], ["#116dd2", "#116dd2", "#1784fb"]),
  red: hue(["#c82532", "#e72e3b", "#c82532"], ["#cf2b35", "#cf2b35", "#f73643"]),
  orange: hue(["#d2550a", "#ee620d", "#d2550a"], ["#cd5309", "#cd5309", "#f4650e"]),
  purple: hue(["#7442d1", "#8351e4", "#7442d1"], ["#7845d7", "#7845d7", "#8e59f8"]),
  cyan: hue(["#0d9381", "#10a693", "#0d9381"], ["#0e9886", "#0e9886", "#12b39f"]),
  magenta: hue(["#c82779", "#e52f8b", "#c82779"], ["#cf297e", "#cf297e", "#f63397"]),
  yellow: hue(["#c2730b", "#da830e", "#c2730b"], ["#c8770c", "#c8770c", "#ea8c10"]),
  brown: hue(["#86592e", "#9d6937", "#86592e"], ["#8c5d31", "#8c5d31", "#aa723d"]),
  // grok's grey bot: a near-black bubble and button in light; in dark an 18% ink bubble and an inverted button
  neutral: hue(["#1c1c1c", "#1c1c1c", "#363636"], ["#3b3b3b", "#f5f5f5", "#dbdbdb"], { light: "#fcfcfc", dark: "#121212" }),
} satisfies Record<string, Record<Scheme, GrokFill>>;

/** Each of our colours on grok's nearest hue; coral sits closer to grok's orange than its red in oklab. */
export const GROK_HUE_OF = {
  green: "green",
  blue: "blue",
  red: "red",
  orange: "orange",
  purple: "purple",
  cyan: "cyan",
  pink: "magenta",
  yellow: "yellow",
  teal: "cyan",
  coral: "orange",
  brown: "brown",
  silver: "neutral",
  chrome: "neutral",
} as const satisfies Record<MausColor, keyof typeof GROK_HUES>;

/** Grok's fills and text for the bot's colour in one scheme. */
export function grokFill(color: MausColor, scheme: Scheme): GrokFill {
  return GROK_HUES[GROK_HUE_OF[color]][scheme];
}

/** One css value for both schemes; grok-dark sets color-scheme, the other skins read the light half. */
export function bothSchemes(light: string, dark: string): string {
  return light === dark ? light : `light-dark(${light}, ${dark})`;
}

/** Grok's text in the bot's colour (sand-text-<hue>-primary, light then dark), as its New line wears; its grey bot's is ink. */
const GROK_TEXT: Record<Exclude<keyof typeof GROK_HUES, "neutral">, readonly [string, string]> = {
  green: ["#00854a", "#00ba69"], blue: ["#0b6dd3", "#4d9bff"], red: ["#cd2834", "#ff6463"], orange: ["#c14c00", "#fe6600"],
  purple: ["#7547d0", "#a582ff"], cyan: ["#008273", "#00b7a2"], magenta: ["#c62378", "#ff55a4"], yellow: ["#aa6300", "#e28600"],
  brown: ["#996b42", "#c59e7d"],
};

export function grokAccentText(color: MausColor): string {
  const hue = GROK_HUE_OF[color];
  return hue === "neutral" ? "var(--color-ink)" : bothSchemes(...GROK_TEXT[hue]);
}

/** Grok's fills as css values that follow the color-scheme. */
export function grokFills(color: MausColor): GrokFill {
  const light = grokFill(color, "light");
  const dark = grokFill(color, "dark");
  return Object.fromEntries(Object.entries(light).map(([key, value]) => [key, bothSchemes(value, dark[key as keyof GrokFill])])) as GrokFill;
}

export type UserBubbleTone = {
  background: string;
  gradient: string;
  ink: string;
  secondary: string;
  tertiary: string;
  panel: string;
  inset: string;
  raised: string;
  raisedHover: string;
  control: string;
  hairline: string;
  accent: string;
  accentText: string;
  accentInk: string;
  focus: string;
  danger: string;
  dangerInk: string;
  success: string;
  successInk: string;
  selection: string;
  selectionInk: string;
};

/** Grok's faint top gloss over the fill. */
export const BUBBLE_GLOSS = "linear-gradient(rgb(255 255 255 / 0.06), transparent)";

/** `hue` eased toward white until it holds `min` on `on`. */
function lightEnough(hue: string, on: string, min: number): string {
  if (contrastRatio(hue, on) >= min) return hue;
  let lo = 0;
  let hi = 1;
  let best = WHITE;
  for (let step = 0; step < 22; step += 1) {
    const mid = (lo + hi) / 2;
    const candidate = mixSrgb(WHITE, hue, mid);
    if (contrastRatio(candidate, on) >= min) {
      best = candidate;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

/** The ink eased toward the fill until it holds just `min`; the ink itself when it cannot. */
function quiet(ink: string, background: string, min: number): string {
  let lo = 0;
  let hi = 1;
  let best = ink;
  for (let step = 0; step < 22; step += 1) {
    const mid = (lo + hi) / 2;
    const candidate = mixSrgb(ink, background, mid);
    if (contrastRatio(candidate, background) >= min) {
      best = candidate;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

function darkInkOn(fill: string): string {
  return contrastRatio(INK, fill) >= contrastRatio(WHITE, fill) ? INK : WHITE;
}

function toneOn(color: MausColor, { bubble: background, ink }: GrokFill): UserBubbleTone {
  const body = contrastRatio(ink, background);
  const secondary = quiet(ink, background, Math.min(6.2, Math.max(BUBBLE_TOKEN_MIN, body * 0.82)));
  let tertiary = quiet(ink, background, Math.min(4.5, Math.max(BUBBLE_TOKEN_MIN, body * 0.68)));
  if (contrastRatio(tertiary, background) > contrastRatio(secondary, background)) tertiary = secondary;
  // surfaces inside the bubble step darker on a vivid fill and lighter on grok's near-black grey, so the ink only gains
  const dim = toOklch(background).l < 0.4;
  const step = dim ? WHITE : BLACK;
  const inset = mixSrgb(BLACK, background, 0.2);
  const raised = mixSrgb(step, background, 0.1);
  const accent = lightEnough(MAUS_COLORS[color], background, BUBBLE_TOKEN_MIN);
  const danger = lightEnough("#ff6d80", background, BUBBLE_TOKEN_MIN);
  const success = lightEnough("#7ddead", background, BUBBLE_TOKEN_MIN);
  return {
    background,
    gradient: BUBBLE_GLOSS,
    ink,
    secondary,
    tertiary,
    panel: mixSrgb(inset, background, 0.45),
    inset,
    raised,
    raisedHover: mixSrgb(step, background, 0.16),
    control: raised,
    hairline: lightEnough(mixSrgb(WHITE, background, 0.45), background, BUBBLE_TOKEN_MIN),
    accent,
    accentText: accent,
    accentInk: darkInkOn(accent),
    focus: ink,
    danger,
    dangerInk: darkInkOn(danger),
    success,
    successInk: darkInkOn(success),
    selection: dim ? mixSrgb(WHITE, background, 0.25) : selectionBackground(background),
    selectionInk: ink,
  };
}

/** The bubble's tokens in one scheme as plain hex, or, with no scheme, as css values that follow the color-scheme. */
export function userBubbleTone(color: MausColor, scheme?: Scheme): UserBubbleTone {
  if (scheme) return toneOn(color, grokFill(color, scheme));
  const light = toneOn(color, grokFill(color, "light"));
  const dark = toneOn(color, grokFill(color, "dark"));
  return Object.fromEntries(
    Object.entries(light).map(([key, value]) => [key, bothSchemes(value, dark[key as keyof UserBubbleTone])]),
  ) as UserBubbleTone;
}

export function mentionChipBackground(mention: string, inset: string): string {
  return mixSrgb(mention, inset, MENTION_CHIP_MIX);
}

export function selectionBackground(background: string): string {
  return mixSrgb(BLACK, background, SELECTION_BLACK_MIX);
}

export function quoteSurface(inset: string, background: string): string {
  return mixSrgb(inset, background, 0.7);
}

/** `flat`: Simple mode's one even fill, the tone's background with no gloss over it. */
export function userBubbleStyle(color: MausColor, { flat = false }: { flat?: boolean } = {}): CSSProperties {
  const tone = userBubbleTone(color);
  return {
    backgroundColor: tone.background,
    backgroundImage: flat ? "none" : tone.gradient,
    "--color-bubble-user": tone.background,
    "--color-bubble-user-ink": tone.ink,
    "--color-ink": tone.ink,
    "--color-ink-secondary": tone.secondary,
    "--color-ink-tertiary": tone.tertiary,
    "--color-panel": tone.panel,
    "--color-inset": tone.inset,
    "--color-raised": tone.raised,
    "--color-raised-hover": tone.raisedHover,
    "--color-control": tone.control,
    "--color-hairline": tone.hairline,
    "--color-accent": tone.accent,
    "--color-accent-text": tone.accentText,
    "--color-accent-ink": tone.accentInk,
    "--color-focus": tone.focus,
    "--color-danger": tone.danger,
    "--color-danger-ink": tone.dangerInk,
    "--color-success": tone.success,
    "--color-success-ink": tone.successInk,
    "--bubble-selection": tone.selection,
    "--bubble-selection-ink": tone.selectionInk,
  } as CSSProperties;
}
