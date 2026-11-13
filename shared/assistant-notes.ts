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
/** 2 asks for About me in sections, open threads, recurring tasks, connected apps and each bot's knowledge files. */
export const NOTES_VERSION = 2;
const TEMPLATE_FROM = "your app's name";

export const NOTES_PROMPT = `I'm moving to a new assistant, dusk bot, and want it to know everything you know about me so I don't start over. Please write me one complete copy. Don't change or delete anything on your side.

Go through everything you have: your saved memories, my custom instructions and personalization, every custom GPT, Project, Gem, agent or bot I made with its own instructions and the files attached to it, my scheduled tasks, my connected apps, and what you've learned about me from our chats.

Create a file named dusk-bot-notes.json holding the JSON below and give it to me to download. If you can't create files, put the whole JSON in one \`\`\`json code block instead.

{
  "format": "${NOTES_FORMAT}",
  "version": ${NOTES_VERSION},
  "from": "${TEMPLATE_FROM}, e.g. ChatGPT",
  "about_me": {
    "basics": ["my name, where I live, my time zone, languages I speak"],
    "work": ["my job, company, role, what I'm responsible for, my field"],
    "projects": ["each project I'm on: what it is, its status, who's involved, key dates"],
    "goals": ["what I'm working toward, short and long term"],
    "people": ["each person I've mentioned: their name, who they are to me, what to remember"],
    "preferences": ["likes, dislikes, food, travel, health, money, and anything else I prefer"],
    "writing_style": ["how I write: tone, length, words I use or avoid, formatting I like, a short sample if you have one"],
    "tools": ["apps, software, devices and services I use"],
    "schedule": ["when I work, sleep and exercise; regular meetings; weekly patterns"]
  },
  "instructions": "my custom instructions and how I've asked you to answer and behave, word for word",
  "memories": ["every saved memory, word for word, one per string, with its date if you know it"],
  "open_threads": ["what's still open: to-dos, open questions, decisions I haven't made, things I said I'd come back to"],
  "recurring_tasks": [{"name": "task name", "instruction": "what it does, word for word", "schedule_text": "when, in words", "schedule_cron": "5-field cron, or empty", "timezone": "IANA time zone"}],
  "connected_apps": ["each app or service connected for me, e.g. Gmail"],
  "bots": [
    {
      "name": "its name",
      "description": "what it's for, in one line",
      "instructions": "its full instructions, word for word, never summarized",
      "knowledge_files": ["the name of each file attached to it"],
      "memories": ["what it knows, one per string"],
      "skills": [{"name": "skill name", "description": "when to use it", "instructions": "the full text"}],
      "routines": [{"name": "routine name", "instruction": "what it does, word for word", "schedule_text": "when, in words", "schedule_cron": "5-field cron, or empty", "timezone": "IANA time zone"}],
      "apps": [{"name": "connected app or tool", "mcp_url": "its remote MCP address, or empty"}]
    }
  ]
}

Rules:
- "bots" has one entry for each custom GPT, Claude Project, Gem, agent or bot I made with its own instructions. Use [] when there are none.
- Copy saved memories and instructions word for word; never summarize them. For everything else be thorough and specific: names, numbers, dates.
- Write only what you actually know. Never guess; leave a list empty instead.
- Leave out passwords, API keys, tokens, account numbers and card numbers.
- Valid JSON only, no comments.
- If it doesn't fit in one reply, split it: send part 1 now, ending at a complete item, and tell me to say "continue" for the next part. Each part is valid JSON on its own, in this same shape, with the same "format".
`;

export interface AssistantNotes {
  /** The app the notes come from, as it named itself, and a slug for file names. */
  from: MoveFrom;
  aboutMe: string[];
  instructions: string;
  memories: string[];
  bots: GrokBot[];
  /** To-dos, open questions and things to come back to. */
  openThreads: string[];
  /** Things it did on a schedule for the person, to set up again here. */
  recurring: Array<{ name: string; instruction: string; when: string }>;
  /** Apps it was connected to for the person, by name. */
  apps: string[];
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
  return items.map((item) => (isRecord(item) ? text(item.text ?? item.content ?? item.fact ?? item.name) : text(item)).replace(BULLET, "").trim()).filter(Boolean);
}

/** About me's sections, each fact led by its section so it still reads right on its own line ("Work: …"). An older
 * block's flat list is read as it is. */
const ABOUT_SECTIONS: Record<string, string> = {
  basics: "", identity: "", work: "Work", projects: "Project", goals: "Goal", people: "Person", preferences: "Preference",
  writing_style: "Writing style", writingStyle: "Writing style", tools: "Uses", schedule: "Schedule",
};

function aboutLines(value: unknown): string[] {
  if (!isRecord(value)) return lines(value);
  return Object.entries(value).flatMap(([key, items]) => {
    const label = ABOUT_SECTIONS[key] ?? key.replace(/[_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
    return lines(items).map((line) => (!label || line.toLowerCase().startsWith(label.toLowerCase()) ? line : `${label}: ${line}`));
  });
}

function tasks(value: unknown): AssistantNotes["recurring"] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [{ name: "", instruction: item.trim(), when: "" }] : [];
    if (!isRecord(item)) return [];
    const instruction = text(item.instruction ?? item.prompt ?? item.task);
    const when = [text(item.schedule_text ?? item.when ?? item.schedule), text(item.schedule_cron) && `(${text(item.schedule_cron)}${text(item.timezone) ? `, ${text(item.timezone)}` : ""})`].filter(Boolean).join(" ");
    return instruction ? [{ name: text(item.name).slice(0, 100), instruction, when }] : [];
  });
}

const uniqueTasks = (items: AssistantNotes["recurring"]) => [...new Map(items.map((item) => [`${item.name}\n${item.instruction}`.toLowerCase(), item])).values()];

/** Each bot's attached files, by name, as a topic of its memory: the files themselves stay in the other app. */
function withKnowledgeFiles(bots: GrokBot[], raw: ReadonlyArray<Record<string, unknown>>): GrokBot[] {
  return bots.map((bot) => {
    const files = union(raw.filter((one) => text(one.name).toLowerCase() === bot.name.toLowerCase()).flatMap((one) => lines(one.knowledge_files ?? one.knowledgeFiles ?? one.files)));
    if (!files.length) return bot;
    return { ...bot, memoryFiles: { ...bot.memoryFiles, "memory/knowledge-files.md": `# Files I had\n\nFiles attached to me in the other app. Only their names came over: ask the person for any you need, or to add them to my folder.\n\n${files.map((file) => `- ${file}`).join("\n")}\n` } };
  });
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
  if (documents.some((document) => typeof document.version === "number" && document.version > NOTES_VERSION)) throw new GrokImportError("newerVersion");
  const rawBots = documents.flatMap((document) => (Array.isArray(document.bots) ? document.bots.filter(isRecord) : []));
  const name = documents.map((document) => text(document.from)).find(Boolean)?.replace(/\s+/g, " ").slice(0, 60) || "another AI";
  const notes: AssistantNotes = redactStrings({
    from: { name, key: slug(name) || "another-ai" },
    aboutMe: union(documents.flatMap((document) => aboutLines(document.about_me ?? document.aboutMe))),
    instructions: union(documents.map((document) => text(document.instructions)).filter(Boolean)).join("\n\n"),
    memories: union(documents.flatMap((document) => lines(document.memories))),
    bots: withKnowledgeFiles(mergeGrokBots(rawBots.map(readBot).filter((bot) => bot.name)), rawBots),
    openThreads: union(documents.flatMap((document) => lines(document.open_threads ?? document.openThreads ?? document.todos))),
    recurring: uniqueTasks(documents.flatMap((document) => tasks(document.recurring_tasks ?? document.recurringTasks ?? document.routines))),
    apps: union(documents.flatMap((document) => lines(document.connected_apps ?? document.connectedApps ?? document.apps).map((app) => app.slice(0, 100)))),
    partial,
  });
  if (!notes.aboutMe.length && !notes.instructions && !notes.memories.length && !notes.bots.length && !notes.openThreads.length && !notes.recurring.length) {
    throw new GrokImportError(partial ? "cutOff" : "notExport");
  }
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

/** The first bot's topic for what is still open, things done on a schedule and connected apps. */
export function notesThreadsFile(notes: Pick<AssistantNotes, "from">): string {
  return `memory/open-threads-from-${notes.from.key}.md`;
}

/** That topic's text, merged with an earlier paste's, each line once; null when there is nothing in it. */
export function notesThreadsText(notes: Pick<AssistantNotes, "from" | "openThreads" | "recurring" | "apps">, before = ""): string | null {
  const earlier = (heading: string) => {
    const at = before.indexOf(`## ${heading}\n`);
    if (at < 0) return [];
    const end = before.indexOf("\n## ", at + 3);
    return before.slice(at, end < 0 ? undefined : end).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
  };
  const flat = (line: string) => line.replace(/\s*\n\s*/g, " ");
  const open = union([...earlier("Still open"), ...notes.openThreads.map(flat)]);
  const recurring = union([...earlier("Done on a schedule"), ...notes.recurring.map((task) => flat(`${task.name ? `${task.name}: ` : ""}${task.instruction}${task.when ? ` (${task.when})` : ""}`))]);
  const apps = union([...earlier("Connected there"), ...notes.apps.map(flat)]);
  if (!open.length && !recurring.length && !apps.length) return null;
  const part = (heading: string, items: string[], lead: string) => (items.length ? [`## ${heading}`, lead, "", ...items.map((item) => `- ${item}`), ""] : []);
  return [`# Open threads from ${notes.from.name}`, "",
    ...part("Still open", open, "To-dos, open questions and things to come back to."),
    ...part("Done on a schedule", recurring, "Ask the person before setting any of these up as a routine here."),
    ...part("Connected there", apps, "Connect these in apps to use them here."),
  ].join("\n");
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
