// A bot's project emoji: one emoji, never a bare component.
// Unicode counts a lone digit, skin tone or regional indicator as an emoji component, not an emoji.
const projectEmojiPattern = new RegExp("^(?!\\p{Emoji_Component}$)(?:\\p{RGI_Emoji}|[\\p{Emoji}--\\p{Emoji_Component}])$", "v");
export function isProjectEmoji(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && projectEmojiPattern.exec(value)?.[0] === value;
}
