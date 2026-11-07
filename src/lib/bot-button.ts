import type { CSSProperties } from "react";
import { mixSrgb } from "./color-contrast";
import type { MausColor } from "./mascot";
import { bothSchemes, grokFill, type Scheme } from "./user-bubble-tone";

/** Pressing steps the hover fill toward black. */
const PRESSED_MIX = 0.12;
const WHITE = "#ffffff";

export const BOT_BUTTON = "bot-button";

export type BotButtonTone = { fill: string; ink: string; hover: string; pressed: string };

/** A bot's own primary button: grok's button fill for the bot's colour under a white label. In one scheme as plain hex,
 * or, with no scheme, as css values that follow the color-scheme. */
export function botButtonTone(color: MausColor, scheme?: Scheme): BotButtonTone {
  if (!scheme) {
    const light = botButtonTone(color, "light");
    const dark = botButtonTone(color, "dark");
    return {
      fill: bothSchemes(light.fill, dark.fill),
      ink: WHITE,
      hover: bothSchemes(light.hover, dark.hover),
      pressed: bothSchemes(light.pressed, dark.pressed),
    };
  }
  const { button, hover } = grokFill(color, scheme);
  return { fill: button, ink: WHITE, hover, pressed: mixSrgb("#000000", hover, PRESSED_MIX) };
}

export function botButtonStyle(color: MausColor): CSSProperties {
  const tone = botButtonTone(color);
  return {
    "--bot-button": tone.fill,
    "--bot-button-ink": tone.ink,
    "--bot-button-hover": tone.hover,
    "--bot-button-pressed": tone.pressed,
  } as CSSProperties;
}

export type BotButton = { className: string; style?: CSSProperties };

/** A primary action that belongs to one bot. `shape` sizes it either way; `plain` is its look when no single bot owns
 * it, as in a room or for a teammate's line. */
export function botButton(color: MausColor | undefined, shape: string, plain: string): BotButton {
  const classes = (look: string) => [shape, look].filter(Boolean).join(" ");
  return color ? { className: classes(BOT_BUTTON), style: botButtonStyle(color) } : { className: classes(plain) };
}
