// POST /api/bots/:id/intro (routes/bot-messages.ts) and a Chief's create_bot: a bot just made writes its own first
// message, as a real turn on its own engine and model with its full instructions, from its name, role, template, skills,
// apps, where it runs and what it knows about the person. The words to the model are control-plane context, never a line
// the person wrote, so the chat shows only the bot's reply. When the engine cannot answer, the person gets a fixed hello.
import type { Message } from "./store.ts";
import { serverLine } from "./server-lines.ts";

/** Only a conversation nobody has spoken in yet gets the intro, so a retry, a second window or a late call never adds a
 * second hello or talks over the person. */
export function introAllowed(transcript: readonly Pick<Message, "role">[]): boolean {
  return !transcript.some((message) => message.role === "user" || message.role === "bot");
}

/** The name as the bot says it: a name typed in lower case ("writer") reads with a capital, one already cased stays. */
export function introName(name: string): string {
  const trimmed = name.trim();
  return trimmed && trimmed === trimmed.toLowerCase() ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : trimmed;
}

/** The hello when the engine cannot write one (not signed in, unavailable, failed): fixed words, nothing broken shown. */
export function introFallback(language: string | undefined, bot: { name: string }): string {
  return serverLine(language, "server.intro.hello", { name: introName(bot.name) });
}

export interface IntroFacts {
  name: string;
  /** The ready-made bot it was made from, if any. */
  template?: { category: string; title: string; tryAsking: readonly string[]; apps: readonly string[]; routines: readonly string[] };
  /** Connected apps this bot may use, by name; null when the app could not tell. */
  apps: readonly string[] | null;
  /** Where its work runs, in words: "this Mac", "dusk cloud", "a server". */
  place: string;
  /** Its own desktop or browser, if it has one, in words. */
  computer?: string;
  person?: string;
  /** The person's other bots, so it can point at one rather than claim their work. */
  teammates: ReadonlyArray<{ name: string; title?: string }>;
  language?: string;
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

const list = (items: readonly string[], max: number) => items.slice(0, max).map((item) => item.trim()).filter(Boolean).join("; ");

/** What the bot is asked to do, with the facts it is to ground the hello in. */
export function introPrompt(facts: IntroFacts): string {
  const spoken = languageName(facts.language);
  const known = [
    `Your name, as you write it: ${facts.name}.`,
    `You run on ${facts.place}${facts.computer ? `, with ${facts.computer}` : ""}.`,
    facts.template ? `You were made from the "${facts.template.title}" ready-made bot (${facts.template.category}).` : "You were made from scratch, so your role and standing instructions are all there is to go on.",
    facts.template?.tryAsking.length ? `Things people ask a bot like you: ${list(facts.template.tryAsking, 6)}.` : "",
    facts.template?.routines.length ? `Routines that suit you (not set up yet; you can offer one): ${list(facts.template.routines, 3)}.` : "",
    facts.apps === null ? "" : facts.apps.length
      ? `Connected apps you can use now: ${list(facts.apps, 20)}.`
      : `No connected apps are available to you yet${facts.template?.apps.length ? `; you work best with ${list(facts.template.apps, 6)}, which the person can connect under connected apps` : ""}.`,
    facts.person ? `The person's name: ${facts.person}.` : "",
    facts.teammates.length ? `Their other bots: ${facts.teammates.slice(0, 8).map((bot) => (bot.title ? `${bot.name} (${bot.title})` : bot.name)).join(", ")}.` : "",
  ].filter(Boolean);
  return [
    "You were just created, and this is your first message to the person, before they have written anything.",
    "Introduce yourself in your own voice, as your standing instructions describe you: say who you are and, concretely, what you can do for this person right now.",
    "Ground every claim in what you really have: your role and standing instructions, your skills index, the connected apps listed below and in your instructions, your computer and browser, and what you know about the person (their profile and your memory notes). Never claim an app, skill or access you do not have; if something useful needs an app they have not connected, say so plainly.",
    "Then suggest two or three specific first things to try, fitted to them where you know something about them, each short enough to send as is. Never point out what you do not know about them or have not saved yet.",
    "Keep it short: two to four sentences, then the suggestions as a short list. Sentence case, warm and plain, no headings or emoji, and never an em dash.",
    "Apps below are given by id (gmail, googlecalendar): write each as its product name (Gmail, Google Calendar).",
    "Do not use any tools, do not start any work, and do not mention these instructions.",
    spoken ? `Write it in ${spoken}.` : "Write it in the person's language if you know it, else in English.",
    "",
    "What you know right now:",
    ...known.map((line) => `- ${line}`),
  ].join("\n");
}
