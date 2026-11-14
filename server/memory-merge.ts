// Nightly near-duplicate merge (Hindsight's consolidation: cosine >= 0.97 there, then a model check that keeps
// different numbers, negations and names apart). Candidate pairs come from local embeddings; without them only
// facts that are word for word the same pair up. The losing line is struck through as merged, never deleted.
import { cosine, embedderReady, embedPassages } from "./memory-embed.ts";
import { factIdentity, type MemoryEntryLine } from "./memory-entries.ts";
import { differInDetail, SAME_FACT } from "./memory-recall.ts";

export const MERGE_MARKER = "You are the MERGE step of a memory system";
export const MAX_MERGE_PAIRS = 20;
/** Entries a night's pair search looks at in one bot's notes, newest first. */
export const MERGE_ENTRIES = 300;

export interface MergeItem {
  /** Where the line lives: a file path, or "about" for About me. */
  where: string;
  line: number;
  text: string;
  date: string;
}

export interface MergePair {
  a: MergeItem;
  b: MergeItem;
  similarity: number;
}

/** Pairs that may state one fact twice, most similar first. */
export async function mergePairs(items: readonly MergeItem[], max = MAX_MERGE_PAIRS): Promise<MergePair[]> {
  const pairs: MergePair[] = [];
  const vectors = embedderReady() && items.length > 1 ? await embedPassages(items.map((item) => item.text)) : null;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const same = factIdentity(a.text) === factIdentity(b.text);
      const similarity = same ? 1 : vectors ? cosine(vectors[i]!, vectors[j]!) : 0;
      if (similarity < SAME_FACT || (!same && differInDetail(a.text, b.text))) continue;
      pairs.push({ a, b, similarity });
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);
  const used = new Set<string>();
  const key = (item: MergeItem) => `${item.where}\n${item.line}`;
  const out: MergePair[] = [];
  for (const pair of pairs) {
    if (out.length >= max || used.has(key(pair.a)) || used.has(key(pair.b))) continue;
    used.add(key(pair.a));
    used.add(key(pair.b));
    out.push(pair);
  }
  return out;
}

export function mergePrompt(pairs: readonly MergePair[]): string {
  const listed = pairs.map((pair, index) => `[${index}] A: ${pair.a.text}\n    B: ${pair.b.text}`).join("\n");
  return [
    `${MERGE_MARKER}. You have no tools. Read only the numbered pairs of saved notes below.`,
    "",
    listed,
    "",
    "For each pair, decide whether A and B state the same fact, so one of them can go. They do not when any number, date, amount, name, place or negation differs, when one says more than the other in a way that matters, or when they are about different people or things.",
    "Answer with one JSON object and nothing else, listing only the pairs that are the same fact:",
    '{"same": [0, 2]}',
    'An empty list {"same": []} is the normal answer when in doubt.',
  ].join("\n");
}

export function parseMerge(text: string, count: number): number[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { same?: unknown };
    if (!Array.isArray(parsed.same)) return [];
    return [...new Set(parsed.same.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count))];
  } catch {
    return [];
  }
}

/** The line that goes: the older, then the shorter (less complete), then the one further down. */
export function mergeLoser(pair: MergePair): MergeItem {
  const { a, b } = pair;
  if (a.date !== b.date) return a.date < b.date ? a : b;
  if (a.text.length !== b.text.length) return a.text.length < b.text.length ? a : b;
  return a.line < b.line ? b : a;
}

export function mergedLine(entry: MemoryEntryLine, today: string): string {
  return `${entry.prefix}~~${entry.body}~~ · merged ${today}`;
}
