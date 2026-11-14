// General memory: what every one of the person's bots knows about them, kept in About me. The person's own lines
// (typed in Settings) and the lines bots learned (`- date · learned by Bot · fact`) live in one text. This module
// decides which of them load each turn within a budget, and plans the nightly consolidation that merges duplicates,
// lets the newer of two contradicting facts win, lifts lasting facts about the person out of each bot's own notes,
// and trims the learned lines to a size budget. What it takes out is kept in a history the person can restore from.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { alwaysCore, factIdentity, foldForMatch, type MemoryEntryLine } from "./memory-entries.ts";
import { BLOCKED_LINE, looksLikeInstruction } from "./memory-trust.ts";

/** Learned lines loaded into every turn beyond the person's own lines; the rest reach a turn through recall. */
export const GENERAL_LOAD_CHARS = 2_000;
/** Health and safety lines always load, up to this much, newest first. */
export const GENERAL_PINNED_CHARS = 1_000;
/** Consolidation keeps the learned lines under this; the oldest past it move to the history. */
export const GENERAL_MAX_CHARS = 12_000;
export const CONSOLIDATE_MARKER = "You are the CONSOLIDATE step of a memory system";
export const MAX_PROMOTIONS = 20;
export const PROMPT_LINES = 150;
const TEXT_MAX = 300;
const HISTORY_MAX = 300;

const LEARNED = /^\s*-\s*(\d{4}-\d{2}-\d{2}) · learned by ([^·\n]*?) · (.*)$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

export interface GeneralLine {
  line: number;
  raw: string;
  fact: string;
  learned: boolean;
  date: string | null;
  by: string | null;
}

/** Every non-blank line except headings is one fact; the person's own lines have no date. */
export function parseGeneral(text: string): GeneralLine[] {
  const out: GeneralLine[] = [];
  text.split("\n").forEach((raw, line) => {
    if (!raw.trim() || /^\s*#/.test(raw)) return;
    const m = LEARNED.exec(raw);
    if (m) out.push({ line, raw, fact: m[3]!.trim(), learned: true, date: m[1]!, by: m[2]!.trim() });
    else out.push({ line, raw, fact: raw.replace(BULLET, "").trim(), learned: false, date: null, by: null });
  });
  return out;
}

const newestFirst = (a: GeneralLine, b: GeneralLine) => (b.date ?? "").localeCompare(a.date ?? "") || b.line - a.line;

/** The text a turn loads: the person's own lines and health or safety facts always, then the newest learned lines
 * within `budget`. Unchanged (the same bytes) when everything fits, so the cached prompt prefix stays the same. */
export function generalForPrompt(raw: string, budget = GENERAL_LOAD_CHARS): { text: string; omitted: GeneralLine[] } {
  const planted = new Set(parseGeneral(raw).filter((entry) => entry.learned && looksLikeInstruction(entry.fact)).map((entry) => entry.line));
  const text = planted.size ? raw.split("\n").map((line, index) => (planted.has(index) ? `- ${BLOCKED_LINE}` : line)).join("\n") : raw;
  const learned = parseGeneral(text).filter((entry) => entry.learned);
  if (learned.reduce((sum, entry) => sum + entry.raw.length + 1, 0) <= budget) return { text, omitted: [] };
  const keep = new Set<number>();
  let used = 0;
  let pinned = 0;
  for (const entry of [...learned].sort((a, b) => Number(alwaysCore(b.fact)) - Number(alwaysCore(a.fact)) || newestFirst(a, b))) {
    const size = entry.raw.length + 1;
    const pin = alwaysCore(entry.fact) && pinned + size <= GENERAL_PINNED_CHARS;
    if (!pin && used + size > budget) continue;
    keep.add(entry.line);
    used += size;
    if (pin) pinned += size;
  }
  const omitted = learned.filter((entry) => !keep.has(entry.line));
  const drop = new Set(omitted.map((entry) => entry.line));
  return { text: text.split("\n").filter((_, index) => !drop.has(index)).join("\n"), omitted };
}

/** A line of one bot's MEMORY.md offered to consolidation. */
export interface NotebookLine {
  botId: string;
  botName: string;
  entry: MemoryEntryLine;
}

/** Lines a bot learned in a group chat may be about someone else, so they never move into the person's general memory. */
export function promotable(entry: MemoryEntryLine): boolean {
  return !entry.struck && !/· from room "/.test(entry.prefix);
}

export function consolidatePrompt(input: { general: readonly GeneralLine[]; notebooks: readonly NotebookLine[]; promote: boolean; today: string }): string {
  const general = input.general.slice(0, PROMPT_LINES).map((entry, i) => `G${i + 1} (${entry.learned ? entry.date : "written by the person"}) ${entry.fact}`).join("\n");
  const notes = input.notebooks.slice(0, PROMPT_LINES).map((note, i) => `B${i + 1} (${note.botName}, ${note.entry.date}) ${note.entry.body}`).join("\n");
  return [
    `${CONSOLIDATE_MARKER}. You have no tools. Read only the numbered lines below. Today is ${input.today}.`,
    "",
    "The person's general memory, which all of their assistants read (G lines, each with the date it was learned):",
    general || "(empty)",
    "",
    "Lines from each assistant's own notes (B lines, with the assistant's name and date):",
    notes || "(none)",
    "",
    "Find:",
    "- same: two lines that state the same fact in different words. drop is the one to remove: the less complete one, or the B line when a G line already says it.",
    "- replaced: a newer line that changes or contradicts an older one about the same thing (a new city, a reversed preference, a new email or phone number, a changed plan). old is the one no longer true: the older line, unless the older one is clearly the correction. When the old line also states something still true, give it as remainder, one sentence; otherwise omit remainder.",
    ...(input.promote ? ["- promote: B lines that are lasting facts about the person themselves that any of their assistants should know: their name, where they live, their work, how they like to be answered, diet and health, the people close to them and how to reach them. Never a project's details, a task, a decision about one piece of work, or a fact about someone else's work."] : []),
    "Two facts that can both be true are neither the same nor replaced. Numbers, signs and names matter. Never invent a match.",
    "Answer with one JSON object and nothing else:",
    `{"same": [{"drop": "G1", "keep": "G2"}], "replaced": [{"old": "G1", "new": "B2", "remainder": "optional"}]${input.promote ? ', "promote": ["B3"]' : ""}}`,
    `Empty lists are the normal answer: {"same": [], "replaced": []${input.promote ? ', "promote": []' : ""}}.`,
  ].join("\n");
}

export interface Consolidation {
  same: Array<{ drop: string; keep: string }>;
  replaced: Array<{ old: string; new: string; remainder?: string }>;
  promote: string[];
}

export function parseConsolidation(text: string, counts: { general: number; notebooks: number }): Consolidation | null {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const body = (fenced ? fenced[1]! : trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const id = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const m = /^\s*([GB])(\d+)\s*$/i.exec(value);
    if (!m) return null;
    const n = Number(m[2]);
    const kind = m[1]!.toUpperCase();
    return n >= 1 && n <= (kind === "G" ? counts.general : counts.notebooks) ? `${kind}${n}` : null;
  };
  const list = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const same = list(parsed.same).flatMap((pair) => {
    const drop = id(pair.drop), keep = id(pair.keep);
    return drop && keep && drop !== keep ? [{ drop, keep }] : [];
  });
  const replaced = list(parsed.replaced).flatMap((pair) => {
    const old = id(pair.old), next = id(pair.new);
    const remainder = typeof pair.remainder === "string" ? pair.remainder.replace(/\s+/g, " ").replace(/~~/g, "").trim().slice(0, TEXT_MAX) : "";
    return old && next && old !== next ? [{ old, new: next, ...(remainder ? { remainder } : {}) }] : [];
  });
  const promote = (Array.isArray(parsed.promote) ? parsed.promote : []).map(id).filter((value): value is string => value?.startsWith("B") === true);
  return { same, replaced, promote: [...new Set(promote)] };
}

export type HistoryReason = "duplicate" | "replaced" | "trimmed";

export interface GeneralRemoval {
  raw: string;
  fact: string;
  reason: HistoryReason;
  /** The fact that took its place, for a replaced or duplicate line. */
  by?: string;
}

export interface NotebookChange {
  /** Lines (entry start indexes) removed from MEMORY.md: duplicates of general memory, or moved into it. */
  drop: Set<number>;
  /** Entries struck through as superseded by a newer fact, with what of them is still true. */
  strike: Map<number, string | undefined>;
  moved: number;
}

export interface GeneralPlan {
  text: string;
  removed: GeneralRemoval[];
  /** Facts lifted from a bot's notes into general memory, as learned lines. */
  added: Array<{ fact: string; botId: string; botName: string; line: string }>;
  notebooks: Map<string, NotebookChange>;
}

export function learnedLine(fact: string, botName: string, date: string): string {
  return `- ${date} · learned by ${botName.replace(/·/g, "-").replace(/\s+/g, " ").trim().slice(0, 60)} · ${fact.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX)}`;
}

/**
 * What the answer changes, within fixed limits the model cannot widen: the person's own lines are never dropped as a
 * duplicate of a learned one (the learned one goes) and at most one of them is replaced per pass; at most a third of
 * the learned lines (two in a short list) go in one pass; a bot's line moves into general memory only when `promote` allows it and never
 * from a group chat; the newest fact wins, and every line removed from general memory goes to the history.
 */
export function planConsolidation(
  general: readonly GeneralLine[],
  notebooks: readonly NotebookLine[],
  answer: Consolidation,
  opts: { text: string; today: string; promote: boolean; maxChars?: number; blocked?: (fact: string) => boolean },
): GeneralPlan {
  const g = (id: string) => (id.startsWith("G") ? general[Number(id.slice(1)) - 1] : undefined);
  const b = (id: string) => (id.startsWith("B") ? notebooks[Number(id.slice(1)) - 1] : undefined);
  const removeGeneral = new Map<number, GeneralRemoval>();
  const added: GeneralPlan["added"] = [];
  const notebookChanges = new Map<string, NotebookChange>();
  const change = (note: NotebookLine) => {
    let found = notebookChanges.get(note.botId);
    if (!found) notebookChanges.set(note.botId, (found = { drop: new Set(), strike: new Map(), moved: 0 }));
    return found;
  };
  const touchedNotes = new Set<NotebookLine>();
  const learnedCount = general.filter((entry) => entry.learned).length;
  const generalBudget = Math.max(2, Math.floor(learnedCount / 3));
  let generalDropped = 0;
  let handDropped = 0;
  const known = new Set(general.map((entry) => factIdentity(entry.fact)));
  const remainders: string[] = [];

  const dropGeneral = (entry: GeneralLine, reason: HistoryReason, by?: string): boolean => {
    if (removeGeneral.has(entry.line)) return true;
    if (!entry.learned && handDropped >= 1) return false;
    if (entry.learned && generalDropped >= generalBudget) return false;
    removeGeneral.set(entry.line, { raw: entry.raw, fact: entry.fact, reason, ...(by ? { by } : {}) });
    if (entry.learned) generalDropped += 1;
    else handDropped += 1;
    return true;
  };
  const promoteNote = (note: NotebookLine): boolean => {
    if (!opts.promote || !promotable(note.entry) || touchedNotes.has(note) || added.length >= MAX_PROMOTIONS || opts.blocked?.(note.entry.body)) return false;
    const key = factIdentity(note.entry.body);
    touchedNotes.add(note);
    change(note).drop.add(note.entry.line);
    change(note).moved += 1;
    if (key && !known.has(key)) {
      known.add(key);
      added.push({ fact: note.entry.body, botId: note.botId, botName: note.botName, line: learnedLine(note.entry.body, note.botName, opts.today) });
    }
    return true;
  };

  for (const pair of answer.same) {
    let drop = pair.drop, keep = pair.keep;
    // the general line is the one everyone reads: a bot's copy of it is the duplicate
    if (drop.startsWith("G") && keep.startsWith("B")) [drop, keep] = [keep, drop];
    const dropG = g(drop), keepG = g(keep), dropB = b(drop);
    if (dropG && keepG) {
      let [loser, winner] = [dropG, keepG];
      if (!loser.learned && winner.learned) [loser, winner] = [winner, loser];
      if (!loser.learned || removeGeneral.has(winner.line)) continue;
      dropGeneral(loser, "duplicate", winner.fact);
    } else if (dropB && keepG && !touchedNotes.has(dropB) && !removeGeneral.has(keepG.line)) {
      touchedNotes.add(dropB);
      change(dropB).drop.add(dropB.entry.line);
    }
  }

  for (const pair of answer.replaced) {
    const oldG = g(pair.old), newG = g(pair.new), oldB = b(pair.old), newB = b(pair.new);
    if (oldG && newG) {
      if (!oldG.learned && !newG.learned) continue;
      // newest wins: a learned line dated after the one said to replace it is not the older one
      if (oldG.learned && newG.learned && oldG.date! > newG.date!) continue;
      if (removeGeneral.has(newG.line)) continue;
      if (dropGeneral(oldG, "replaced", newG.fact) && pair.remainder) remainders.push(pair.remainder);
    } else if (oldB && newG) {
      if (touchedNotes.has(oldB) || oldB.entry.struck || removeGeneral.has(newG.line)) continue;
      touchedNotes.add(oldB);
      change(oldB).strike.set(oldB.entry.line, pair.remainder);
    } else if (oldG && newB) {
      // a bot heard the newer fact: it moves into general memory and the old line leaves it
      if (!opts.promote || !promotable(newB.entry) || (oldG.learned && oldG.date! > newB.entry.date)) continue;
      if (!promoteNote(newB)) continue;
      if (dropGeneral(oldG, "replaced", newB.entry.body) && pair.remainder) remainders.push(pair.remainder);
    }
  }

  for (const id of answer.promote) {
    const note = b(id);
    if (note) promoteNote(note);
  }

  for (const remainder of remainders) {
    const key = factIdentity(remainder);
    if (!key || known.has(key)) continue;
    known.add(key);
    added.push({ fact: remainder, botId: "", botName: "tidy-up", line: learnedLine(remainder, "tidy-up", opts.today) });
  }

  // the size budget: the oldest learned lines past it go to the history (health and safety facts never do)
  const maxChars = opts.maxChars ?? GENERAL_MAX_CHARS;
  const live = general.filter((entry) => entry.learned && !removeGeneral.has(entry.line));
  let size = live.reduce((sum, entry) => sum + entry.raw.length + 1, 0) + added.reduce((sum, entry) => sum + entry.line.length + 1, 0);
  for (const entry of [...live].sort((x, y) => -newestFirst(x, y))) {
    if (size <= maxChars) break;
    if (alwaysCore(entry.fact)) continue;
    removeGeneral.set(entry.line, { raw: entry.raw, fact: entry.fact, reason: "trimmed" });
    size -= entry.raw.length + 1;
  }

  const kept = opts.text.split("\n").filter((_, index) => !removeGeneral.has(index));
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();
  const text = [...kept, ...added.map((entry) => entry.line)].join("\n");
  return { text, removed: [...removeGeneral.values()], added, notebooks: notebookChanges };
}

/** MEMORY.md after a consolidation's changes to it: dropped entries go whole, struck ones are marked superseded. */
export function applyNotebookChange(text: string, entries: readonly MemoryEntryLine[], planned: NotebookChange, today: string): string {
  const lines = text.split("\n");
  const drop = new Set<number>();
  for (const entry of entries) {
    if (planned.drop.has(entry.line)) for (let line = entry.line; line < entry.end; line++) drop.add(line);
    if (planned.strike.has(entry.line)) {
      const remainder = planned.strike.get(entry.line);
      const struck = `${entry.prefix}~~${entry.body}~~ · superseded ${today}`;
      lines[entry.line] = remainder ? `${struck}\n- ${today} · from tidy-up · ${remainder}` : struck;
    }
  }
  return lines.filter((_, index) => !drop.has(index)).join("\n");
}

// --- history: what consolidation, or a newer fact, took out of general memory -------------------------------------

export interface HistoryEntry {
  id: string;
  line: string;
  fact: string;
  reason: HistoryReason;
  by?: string;
  at: number;
}

function historyPath(): string {
  return join(DATA_DIR, "general-memory-history.json");
}

export function listGeneralHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(historyPath(), "utf8")) as { entries?: unknown };
    return (Array.isArray(parsed.entries) ? parsed.entries : []).filter((entry): entry is HistoryEntry =>
      Boolean(entry) && typeof entry.id === "string" && typeof entry.line === "string" && typeof entry.fact === "string" && typeof entry.at === "number"
      && ["duplicate", "replaced", "trimmed"].includes(entry.reason));
  } catch {
    return [];
  }
}

function saveHistory(entries: readonly HistoryEntry[]): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileAtomic(historyPath(), `${JSON.stringify({ entries: entries.slice(-HISTORY_MAX) }, null, 2)}\n`, { mode: 0o600 });
}

export function recordGeneralHistory(removed: readonly GeneralRemoval[], now = Date.now()): void {
  if (!removed.length) return;
  saveHistory([...listGeneralHistory(), ...removed.map((entry) => ({ id: randomUUID(), line: entry.raw, fact: entry.fact, reason: entry.reason, ...(entry.by ? { by: entry.by } : {}), at: now }))]);
}

/** Puts a line back into About me, as it was; the history keeps no copy of it after. */
export function restoreGeneralHistory(id: string, aboutMe: string): { aboutMe: string; entry: HistoryEntry } | null {
  const entries = listGeneralHistory();
  const entry = entries.find((item) => item.id === id);
  if (!entry) return null;
  const present = parseGeneral(aboutMe).some((line) => factIdentity(line.fact) === factIdentity(entry.fact));
  const base = aboutMe.replace(/\s+$/, "");
  const next = present ? aboutMe : base ? `${base}\n${entry.line}` : entry.line;
  saveHistory(entries.filter((item) => item.id !== id));
  return { aboutMe: next, entry };
}

/** Whether a note is one of `olds`: the model copies the old line, and a copy that drops a date mark, a bullet or a
 * full stop, or quotes three quarters or more of the line (twelve characters or more), still names it. */
export function namesFact(olds: readonly string[]): (fact: string) => boolean {
  const fold = (text: string) => foldForMatch(factIdentity(text.replace(/ · (?:updated|confirmed|until|expired|superseded|merged|moved) \d{4}-\d{2}-\d{2}/g, ""))).replace(/[.!]+$/, "");
  const wanted = olds.map(fold).filter((fact) => fact.length >= 3);
  return (fact) => {
    if (!wanted.length) return false;
    const folded = fold(fact);
    // a quote names a line only when it is most of that line: "lives in Pune" never names "Priya lives in Pune with Sam"
    return wanted.some((want) => want === folded || (want.length >= 12 && folded.includes(want) && want.length >= 0.75 * folded.length));
  };
}

/** About me with the learned lines whose fact is one of `facts` taken out (a newer fact replaces them). */
export function withoutLearnedFacts(aboutMe: string, facts: readonly string[], keep: ReadonlySet<string> = new Set()): { text: string; removed: GeneralLine[] } {
  if (!facts.length) return { text: aboutMe, removed: [] };
  const names = namesFact(facts);
  const removed = parseGeneral(aboutMe).filter((entry) => entry.learned && names(entry.fact) && !keep.has(entry.raw));
  if (!removed.length) return { text: aboutMe, removed: [] };
  const drop = new Set(removed.map((entry) => entry.line));
  return { text: aboutMe.split("\n").filter((_, index) => !drop.has(index)).join("\n"), removed };
}
