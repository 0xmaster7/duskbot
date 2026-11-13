import { describe, expect, it } from "vitest";

import { aboutMeWithNotes, closeCutOff, isNotesPrompt, looksLikeNotes, notesMemoryText, NOTES_FORMAT, NOTES_PROMPT, parseNotes } from "./assistant-notes.ts";
import { GrokImportError } from "./grok-import.ts";

const block = (extra: Record<string, unknown> = {}) => JSON.stringify({
  format: NOTES_FORMAT, version: 1, from: "ChatGPT",
  about_me: ["Name is Sam.", "Lives in Lisbon, time zone Europe/Lisbon."],
  instructions: "Short answers. No emoji.",
  memories: ["Working on a bakery website, launch in March.", "Prefers Notion for notes."],
  bots: [{ name: "Recipe helper", instructions: "Help Sam scale recipes.", memories: ["Sam bakes sourdough."],
    skills: [{ name: "scale", description: "Scale a recipe.", instructions: "Multiply each amount." }] }],
  ...extra,
}, null, 2);

const code = (error: unknown) => (error instanceof GrokImportError ? error.code : String(error));

describe("the copy prompt", () => {
  it("asks for one marked block with every part the importer splits", () => {
    for (const key of [NOTES_FORMAT, "about_me", "instructions", "memories", "bots", "skills", "routines", "apps"]) expect(NOTES_PROMPT).toContain(key);
    expect(NOTES_PROMPT).not.toContain("—");
    expect(looksLikeNotes(NOTES_PROMPT), "the prompt itself has the marker, so a pasted prompt is caught, never sent").toBe(true);
    expect(isNotesPrompt(NOTES_PROMPT)).toBe(true);
    expect(isNotesPrompt(block())).toBe(false);
    expect(code(captured(() => parseNotes(NOTES_PROMPT))), "its example block is never read as notes").toBe("cutOff");
  });
});

describe("parsing pasted notes", () => {
  it("splits one block into about me, instructions, memories and bots", () => {
    const notes = parseNotes(`Here you go!\n\n\`\`\`json\n${block()}\n\`\`\`\n\nLet me know if you need more.`);
    expect(notes.from).toEqual({ name: "ChatGPT", key: "chatgpt" });
    expect(notes.aboutMe).toEqual(["Name is Sam.", "Lives in Lisbon, time zone Europe/Lisbon."]);
    expect(notes.instructions).toBe("Short answers. No emoji.");
    expect(notes.memories).toHaveLength(2);
    expect(notes.bots.map((bot) => [bot.name, bot.skills.length, bot.memories])).toEqual([["Recipe helper", 1, ["Sam bakes sourdough."]]]);
    expect(notes.partial).toBe(false);
  });

  it("reads what a chat window does to a block: smart quotes, trailing commas, a string where a list was asked", () => {
    const messy = block({ about_me: "- Name is Sam.\n- Has a dog called Pip." }).replace(/"/g, (_, at: number) => (at % 2 ? "“" : "”")).replace(/\n}$/, ",\n}");
    const notes = parseNotes(messy);
    expect(notes.aboutMe).toEqual(["Name is Sam.", "Has a dog called Pip."]);
  });

  it("joins a reply split in parts, each fact once", () => {
    const first = block({ memories: ["One."], bots: [] });
    const second = JSON.stringify({ format: NOTES_FORMAT, version: 1, from: "ChatGPT", about_me: ["Name is Sam.", "Plays piano."], memories: ["Two."] });
    const notes = parseNotes(`Part 1\n${first}\n\nPart 2\n${second}`);
    expect(notes.aboutMe).toEqual(["Name is Sam.", "Lives in Lisbon, time zone Europe/Lisbon.", "Plays piano."]);
    expect(notes.memories).toEqual(["One.", "Two."]);
  });

  it("keeps what was whole before a cut-off end, and says it was cut off", () => {
    const whole = block();
    const cut = whole.slice(0, whole.indexOf("Prefers Notion") + 6);
    const notes = parseNotes(cut);
    expect(notes.partial).toBe(true);
    expect(notes.aboutMe).toHaveLength(2);
    expect(notes.memories).toEqual(["Working on a bakery website, launch in March."]);
    expect(notes.bots).toEqual([]);
  });

  it("refuses text that is not notes, a cut with nothing whole, and a block with credential keys", () => {
    expect(code(captured(() => parseNotes("just a normal message {with braces}")))).toBe("notExport");
    expect(code(captured(() => parseNotes(`{"format": "${NOTES_FORMAT}", "about_`)))).toBe("cutOff");
    expect(code(captured(() => parseNotes(block({ api_key: "x" }))))).toBe("credentials");
    expect(code(captured(() => parseNotes(JSON.stringify({ format: NOTES_FORMAT, version: 1 }))))).toBe("notExport");
  });

  it("redacts token-shaped text inside the notes", () => {
    const notes = parseNotes(block({ memories: ["My key is sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD"] }));
    expect(notes.memories[0]).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
  });

  it("names notes with no app 'another AI'", () => {
    expect(parseNotes(block({ from: "" })).from).toEqual({ name: "another AI", key: "another-ai" });
  });
});

describe("closing a cut-off block", () => {
  it("closes at the last whole item", () => {
    expect(closeCutOff('{"a": [1, 2, {"b": "x"}, {"c": "half')).toBe('{"a": [1, 2, {"b": "x"}]}');
    expect(closeCutOff('{"a": "whole"}')).toBe('{"a": "whole"}');
    expect(closeCutOff('{"a": "nothing whole')).toBeNull();
  });
});

describe("where notes land", () => {
  const notes = parseNotes(block());
  it("adds new facts and instructions to About me under the app's name, and nothing twice", () => {
    const first = aboutMeWithNotes("I run a bakery.", notes)!;
    expect(first.text).toContain("I run a bakery.\n\nFrom ChatGPT:\n- Name is Sam.");
    expect(first.text).toContain("How I like answers (from ChatGPT):\nShort answers. No emoji.");
    expect(first.added).toBe(3);
    expect(aboutMeWithNotes(first.text, notes), "a second paste adds nothing").toBeNull();
  });

  it("keeps memories in one topic per app, merged with an earlier paste", () => {
    const first = notesMemoryText(notes)!;
    expect(first).toContain("# Notes from ChatGPT");
    const again = notesMemoryText({ from: notes.from, memories: ["Prefers Notion for notes.", "New one."] }, first)!;
    expect(again.match(/^- /gm)).toHaveLength(3);
  });
});

function captured(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}
