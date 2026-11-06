/** How every bot talks: one app-level choice, warm when none was made. */
export const TALKING_STYLES = ["casual", "warm", "native"] as const;
export type TalkingStyle = (typeof TALKING_STYLES)[number];
export const DEFAULT_TALKING_STYLE: TalkingStyle = "warm";

export function talkingStyleOf(value: unknown): TalkingStyle {
  return TALKING_STYLES.includes(value as TalkingStyle) ? value as TalkingStyle : DEFAULT_TALKING_STYLE;
}
