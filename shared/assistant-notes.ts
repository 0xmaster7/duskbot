// Notes from an assistant whose files this computer can't read (ChatGPT, Claude, Gemini, Grok, a bot in another app):
// the person pastes NOTES_PROMPT there, and that assistant writes everything it knows into one JSON block marked with
// NOTES_FORMAT. Pasted or dropped into any chat here, the block is split into About me, the first bot's memory, and a
// bot each for its custom assistants. One combined block, not a file per bot: one copy and one paste whatever the
// assistant holds, and the importer, not the person, does the sorting. Pure text: the renderer and tests both read it.
import {
  bracedObjects, credentialKeys, GrokImportError, looseJson, mergeGrokBots, readBot, redactStrings, type GrokBot, type MoveFrom,
} from "./grok-import.ts";

export const NOTES_FORMAT = "dusk-bot-notes";
export const NOTES_MAX_CHARS = 4 * 1024 * 1024;
const TEMPLATE_FROM = "your app's name";

export const NOTES_PROMPT = `I'm setting up a new assistant and want it to know what you know about me. Write me one complete copy of it. Don't change or delete anything on your side.

Reply with one \`\`\`json code block, in exactly this shape:

{
  "format": "${NOTES_FORMAT}",
  "version": 1,
  "from": "${TEMPLATE_FROM}, e.g. ChatGPT",
  "about_me": ["one fact about me per string: my name, work, where I live and my time zone, people in my life, tastes, goals"],
  "instructions": "how I've asked you to answer and behave (custom instructions, saved preferences), word for word",
  "memories": ["everything else you remember, one per string: projects, ongoing work, decisions, recurring tasks, with dates where you know them"],
  "bots": [
    {
      "name": "its name",
      "instructions": "its full instructions, word for word",
      "memories": ["what it knows, one per string"],
      "skills": [{"name": "skill name", "description": "when to use it", "instructions": "the full text"}],
      "routines": [{"name": "routine name", "instruction": "what it does, word for word", "schedule_text": "when, in words", "schedule_cron": "5-field cron, or empty", "timezone": "IANA time zone"}],
      "apps": [{"name": "connected app or tool", "mcp_url": "its remote MCP address, or empty"}]
    }
  ]
}

"bots" has one entry for each custom assistant, project, Gem or agent you keep with its own instructions (or every bot, if you run several). Use [] when there are none.
Be thorough and specific. Write only what you actually know; never guess. Leave out passwords, API keys, tokens and card numbers.
If it doesn't fit in one reply, end at a complete item and say so; I'll ask for the rest in the same shape.
`;

export interface AssistantNotes {
  /** The app the notes come from, as it named itself, and a slug for file names. */
  from: MoveFrom;
  aboutMe: string[];
  instructions: string;
  memories: string[];
  bots: GrokBot[];
  /** The block was cut off: what was whole before the cut is here, the rest is missing. */
  partial: boolean;
}

/** Cheap enough to run on every paste: the marker and an opening brace. Whether it really is notes is parseNotes's call. */
export function looksLikeNotes(text: string): boolean {
  return text.length <= NOTES_MAX_CHARS && text.includes(NOTES_FORMAT) && text.includes("{");
}

/** The prompt itself, pasted here instead of into the other AI: its example block must never be read as notes. */
export function isNotesPrompt(text: string): boolean {
  return text.includes(`"from": "${TEMPLATE_FROM}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isNotes = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && value.format === NOTES_FORMAT && !(typeof value.from === "string" && value.from.startsWith(TEMPLATE_FROM));
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** A list of strings, or one string with a fact per line, as assistants sometimes write it. */
function lines(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : [];
  return items.map((item) => (isRecord(item) ? text(item.text ?? item.content ?? item.fact) : text(item)).replace(BULLET, "").trim()).filter(Boolean);
}

/** A block that stops mid-way, closed at the last whole item: the brackets still open are closed and the half-written
 * item is dropped. Null when nothing whole came before the cut. */
export function closeCutOff(source: string): string | null {
  const open: string[] = [];
  let quoted = false, escaped = false;
  let safe: { at: number; open: string[] } | null = null;
  for (let at = 0; at < source.length; at += 1) {
    const ch = source[at]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "{" || ch === "[") open.push(ch);
    else if (ch === "}" || ch === "]") {
      open.pop();
      if (!open.length) return source.slice(0, at + 1);
      safe = { at: at + 1, open: [...open] };
    } else if (ch === "," && open.length) safe = { at, open: [...open] };
  }
  if (!safe) return null;
  return source.slice(0, safe.at).replace(/,\s*$/, "") + safe.open.reverse().map((ch) => (ch === "{" ? "}" : "]")).join("");
}

function documentsIn(source: string): { documents: Array<Record<string, unknown>>; partial: boolean } {
  const repaired = source.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  for (const version of repaired === source ? [source] : [source, repaired]) {
    const whole = looseJson(version.trim());
    if (isNotes(whole)) return { documents: [whole], partial: false };
    const documents = bracedObjects(version).map(looseJson).filter(isNotes);
    if (documents.length) return { documents, partial: false };
  }
  // cut off: the last block's opening brace is the one before its marker
  const marker = repaired.lastIndexOf(NOTES_FORMAT);
  const start = marker < 0 ? -1 : repaired.lastIndexOf("{", marker);
  const closed = start < 0 ? null : closeCutOff(repaired.slice(start));
  const salvaged = closed === null ? undefined : looseJson(closed);
  return isNotes(salvaged) ? { documents: [salvaged], partial: true } : { documents: [], partial: false };
}

const slug = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const union = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The notes in a reply or file: one block, several (a reply split in parts), chat text around them, a cut-off end.
 * Credential-looking keys refuse the whole paste and token-shaped text is redacted, before anything uses it. */
export function parseNotes(source: string): AssistantNotes {
  if (source.length > NOTES_MAX_CHARS) throw new GrokImportError("tooLarge");
  const { documents, partial } = documentsIn(source.replace(/^﻿/, ""));
  if (!documents.length) throw new GrokImportError(source.includes(NOTES_FORMAT) ? "cutOff" : "notExport");
  const refused = documents.flatMap((document) => credentialKeys(document));
  if (refused.length) throw new GrokImportError("credentials", refused.slice(0, 5));
  if (documents.some((document) => typeof document.version === "number" && document.version > 1)) throw new GrokImportError("newerVersion");
  const name = documents.map((document) => text(document.from)).find(Boolean)?.replace(/\s+/g, " ").slice(0, 60) || "another AI";
  const notes: AssistantNotes = redactStrings({
    from: { name, key: slug(name) || "another-ai" },
    aboutMe: union(documents.flatMap((document) => lines(document.about_me ?? document.aboutMe))),
    instructions: union(documents.map((document) => text(document.instructions)).filter(Boolean)).join("\n\n"),
    memories: union(documents.flatMap((document) => lines(document.memories))),
    bots: mergeGrokBots(documents.flatMap((document) => (Array.isArray(document.bots) ? document.bots.filter(isRecord) : []))
      .map(readBot).filter((bot) => bot.name)),
    partial,
  });
  if (!notes.aboutMe.length && !notes.instructions && !notes.memories.length && !notes.bots.length) throw new GrokImportError(partial ? "cutOff" : "notExport");
  return notes;
}

/** The first bot's memory topic for what the assistant remembered: projects and ongoing work, by the app it came from. */
export function notesMemoryFile(notes: Pick<AssistantNotes, "from">): string {
  return `memory/notes-from-${notes.from.key}.md`;
}

/** The memory topic's text, merged with what an earlier paste from the same app left there, each line once. */
export function notesMemoryText(notes: Pick<AssistantNotes, "from" | "memories">, before = ""): string | null {
  const earlier = before.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
  const all = union([...earlier, ...notes.memories.map((line) => line.replace(/\s*\n\s*/g, " "))]);
  if (!all.length) return null;
  return `# Notes from ${notes.from.name}\n\nWhat ${notes.from.name} remembered, brought over when you moved.\n\n${all.map((line) => `- ${line}`).join("\n")}\n`;
}

export const ABOUT_ME_LIMIT = 24_000;

/** About me with the person's facts and their standing instructions added under a heading for the app, lines it already
 * has left out; null when nothing is new. What doesn't fit the limit is left out from the end. */
export function aboutMeWithNotes(current: string, notes: Pick<AssistantNotes, "from" | "aboutMe" | "instructions">): { text: string; added: number } | null {
  const have = new Set(current.split("\n").map((line) => line.replace(BULLET, "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean));
  const facts = notes.aboutMe.map((line) => line.replace(/\s*\n\s*/g, " ")).filter((line) => !have.has(line.replace(/\s+/g, " ").toLowerCase()));
  const instructions = notes.instructions && !current.includes(notes.instructions.trim()) ? notes.instructions.trim() : "";
  if (!facts.length && !instructions) return null;
  const parts = [
    ...(facts.length ? [`From ${notes.from.name}:\n${facts.map((line) => `- ${line}`).join("\n")}`] : []),
    ...(instructions ? [`How I like answers (from ${notes.from.name}):\n${instructions}`] : []),
  ];
  const lead = current.trimEnd();
  const text = `${lead}${lead ? "\n\n" : ""}${parts.join("\n\n")}`.slice(0, ABOUT_ME_LIMIT);
  return { text, added: facts.length + (instructions ? 1 : 0) };
}
