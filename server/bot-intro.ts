// POST /api/bots/:id/intro (routes/bot-messages.ts): a bot just made says hello in its own voice, from its name, role,
// standing instructions and what it already knows about the person. The words to the model are control-plane context,
// never a line the person wrote, so the chat shows only the bot's reply.
import type { Message } from "./store.ts";

/** Only a conversation nobody has spoken in yet gets the intro, so a retry, a second window or a late call never adds a
 * second hello or talks over the person. */
export function introAllowed(transcript: readonly Pick<Message, "role">[]): boolean {
  return !transcript.some((message) => message.role === "user" || message.role === "bot");
}

function languageName(code: string | undefined): string | null {
  const tag = code?.trim();
  if (!tag || /^en(?:-|$)/i.test(tag)) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? null;
  } catch {
    return null;
  }
}

/** What the bot is asked to do; `language` is the conversation's, from Settings. */
export function introPrompt(language?: string): string {
  const spoken = languageName(language);
  return [
    "You were just created, and this is your first message to the person, before they have written anything.",
    "Introduce yourself in your own voice: your name, and in a sentence or two what you will do for them, taken from your role and standing instructions.",
    "Make it specific with what you already know about them: their profile, your memory notes and the apps they have connected. Do not list that back to them, and never claim an app or access you do not have.",
    "End with one or two short questions or concrete offers that would start the first useful piece of work.",
    "Keep it under 70 words, plain and warm. No headings, lists or emoji. Do not use any tools and do not start any work in this message.",
    spoken ? `Write it in ${spoken}.` : "Write it in the person's language if you know it, else in English.",
  ].join(" ");
}
