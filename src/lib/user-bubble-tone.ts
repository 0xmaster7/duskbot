// Fills the person's bubble with Grok Bot's own colour for the bot's hue, always under white text.

import type { CSSProperties } from "react";
import { contrastRatio, mixSrgb, toOklch } from "./color-contrast";
import { MAUS_COLORS, type MausColor } from "./mascot";

const WHITE = "#ffffff";
const BLACK = "#000000";
const INK = "#101410";
/** Grok's fills do not all reach 4.5:1 under white (orange ~4:1, yellow ~3.6:1), so what we derive holds 3:1. */
export const BUBBLE_TOKEN_MIN = 3;

export const MENTION_CHIP_MIX = 0.22;
export const SELECTION_BLACK_MIX = 0.35;

export type Scheme = "light" | "dark";

/** Grok's palette steps for one hue: light /2 (bubble) and /1 (button), dark /1 (both) and /2 (hover). */
type GrokSteps = { bubble: string; button: string; dark: string; darkHover: string };

const steps = (bubble: string, button: string, dark: string, darkHover: string): GrokSteps => ({ bubble, button, dark, darkHover });

const GROK_HUES = {
  green: steps("#0d9655", "#10ab61", "#0e9f5a", "#13bb6b"),
  blue: steps("#126fd4", "#1680f3", "#116dd2", "#1784fb"),
  red: steps("#c82532", "#e72e3b", "#cf2b35", "#f73643"),
  orange: steps("#d2550a", "#ee620d", "#cd5309", "#f4650e"),
  purple: steps("#7442d1", "#8351e4", "#7845d7", "#8e59f8"),
  cyan: steps("#0d9381", "#10a693", "#0e9886", "#12b39f"),
  magenta: steps("#c82779", "#e52f8b", "#cf297e", "#f63397"),
  yellow: steps("#c2730b", "#da830e", "#c8770c", "#ea8c10"),
  brown: steps("#86592e", "#9d6937", "#8c5d31", "#aa723d"),
  neutral: steps("#1c1c1c", "#1c1c1c", "#3b3b3b", "#474747"),
} satisfies Record<string, GrokSteps>;

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

export type GrokFill = { bubble: string; button: string; hover: string };

/** Grok's fills for the bot's colour in one scheme. In light the bubble is the darker step and the button the brighter
 * one, darkening to the bubble's on hover; in dark both share the primary, which brightens on hover. */
export function grokFill(color: MausColor, scheme: Scheme): GrokFill {
  const hue = GROK_HUES[GROK_HUE_OF[color]];
  return scheme === "light"
    ? { bubble: hue.bubble, button: hue.button, hover: hue.bubble }
    : { bubble: hue.dark, button: hue.dark, hover: hue.darkHover };
}

/** One css value for both schemes; grok-dark sets color-scheme, the other skins read the light half. */
export function bothSchemes(light: string, dark: string): string {
  return light === dark ? light : `light-dark(${light}, ${dark})`;
}

/** Grok's fills as css values that follow the color-scheme. */
export function grokFills(color: MausColor): GrokFill {
  const light = grokFill(color, "light");
  const dark = grokFill(color, "dark");
  return { bubble: bothSchemes(light.bubble, dark.bubble), button: bothSchemes(light.button, dark.button), hover: bothSchemes(light.hover, dark.hover) };
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

/** White eased toward the fill until it holds just `min`; white itself when it cannot. */
function quiet(background: string, min: number): string {
  let lo = 0;
  let hi = 1;
  let best = WHITE;
  for (let step = 0; step < 22; step += 1) {
    const mid = (lo + hi) / 2;
    const candidate = mixSrgb(WHITE, background, mid);
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

function toneOn(color: MausColor, background: string): UserBubbleTone {
  const white = contrastRatio(WHITE, background);
  const secondary = quiet(background, Math.min(6.2, Math.max(BUBBLE_TOKEN_MIN, white * 0.82)));
  let tertiary = quiet(background, Math.min(4.5, Math.max(BUBBLE_TOKEN_MIN, white * 0.68)));
  if (contrastRatio(tertiary, background) > contrastRatio(secondary, background)) tertiary = secondary;
  // surfaces inside the bubble step darker on a vivid fill and lighter on grok's near-black grey, so white only gains
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
    ink: WHITE,
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
    focus: WHITE,
    danger,
    dangerInk: darkInkOn(danger),
    success,
    successInk: darkInkOn(success),
    selection: dim ? mixSrgb(WHITE, background, 0.25) : selectionBackground(background),
    selectionInk: WHITE,
  };
}

/** The bubble's tokens in one scheme as plain hex, or, with no scheme, as css values that follow the color-scheme. */
export function userBubbleTone(color: MausColor, scheme?: Scheme): UserBubbleTone {
  if (scheme) return toneOn(color, grokFill(color, scheme).bubble);
  const light = toneOn(color, grokFill(color, "light").bubble);
  const dark = toneOn(color, grokFill(color, "dark").bubble);
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
