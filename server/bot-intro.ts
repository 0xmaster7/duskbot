// POST /api/bots/:id/intro (routes/bot-messages.ts): a bot just made says a static hello, with no model call.
import type { Message } from "./store.ts";

/** Only a conversation nobody has spoken in yet gets the intro, so a retry, a second window or a late call never adds a
 * second hello or talks over the person. */
export function introAllowed(transcript: readonly Pick<Message, "role">[]): boolean {
  return !transcript.some((message) => message.role === "user" || message.role === "bot");
}

/** The hello: fixed words from the bot's name and role, never a model call. A new bot must cost nothing until the
 * person writes to it, and on their own API key even one introduction turn is a charge they did not ask for. */
export function introText(bot: { name: string; title?: string }): string {
  const role = bot.title?.trim();
  return `Hi, I'm ${bot.name}${role ? ` (${role})` : ""}. Tell me what you'd like to start with and I'll take it from there.`;
}
