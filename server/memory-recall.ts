// Fact recall: words (FTS5 BM25), meaning (local embeddings), names and time, fused by reciprocal rank (k = 60, as
// Hindsight's TEMPR does), then gently boosted for recency and for falling inside the asked-about time. Replaced and
// expired facts answer only questions about the past.
import { factIdentity, parseMemoryEntries } from "./memory-entries.ts";
import { cosine, embedderReady, embedQuery, warmEmbedder } from "./memory-embed.ts";
import { embedPendingFacts, factsOf, factVectors, searchFactText, syncAboutFacts, syncWorkspaceFacts, type FactRow, type FactStatus } from "./memory-facts.ts";
import { daysOutside, overlaps, queryTime, type DayRange } from "./memory-time.ts";
import { parseGeneral } from "./general-memory.ts";
import { recallTerms } from "./message-db.ts";

export const RRF_K = 60;
const CANDIDATES = 60;
/** Cosine similarity a fact needs on meaning alone to count as relevant (bge-small: unrelated pairs sit near 0.4-0.5). */
export const SIMILAR = 0.6;
const SIMILAR_WITH_WORDS = 0.5;
const MAX_FACTS = 14;
const RECENCY_DAYS = 365;

export interface RecalledFact {
  fact: FactRow;
  score: number;
  /** Shown as history ("was … until …"), not as how things are. */
  past: boolean;
}

export interface FactRecallInput {
  /** Workspace ids whose notes this turn reads. */
  memoryIds: readonly string[];
  about?: { owner: string; text: string };
  query: string;
  today: string;
  /** Text already in the prompt: facts in it are not recalled again. */
  loaded?: readonly string[];
}

const QUESTION = /\?\s*$|^\s*(?:what|when|where|who|whom|which|why|how|did|do|does|have|has|is|are|was|were|can|could|should|will|would)\b/i;
const ABOUT_THEM = /\b(?:my|me|mine|i|i'm|i've|we|our|us|remember|told you)\b/i;

/** A question about the person or what they told the bot: when nothing is recalled, the bot is told so. */
export function asksMemory(query: string): boolean {
  return QUESTION.test(query.trim()) && ABOUT_THEM.test(query);
}

function loadedIdents(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const entry of parseMemoryEntries(text)) out.add(factIdentity(entry.body));
    for (const line of parseGeneral(text)) out.add(factIdentity(line.fact));
  }
  return out;
}

const PROPER = /\b\p{Lu}[\p{L}'-]{2,}\b/gu;
const NOT_NAMES = new Set("I What When Where Who Which Why How Did Do Does Have Has Is Are Was Were Can Could Should Will Would The This That My Our Your Please Tell Remind Remember".split(" "));

function names(text: string): string[] {
  return [...new Set([...text.matchAll(PROPER)].map((m) => m[0]).filter((word) => !NOT_NAMES.has(word)))];
}

function factDay(fact: FactRow): string | null {
  return fact.validFrom ?? (Number.isFinite(fact.learnedAt) ? new Date(fact.learnedAt).toISOString().slice(0, 10) : null);
}

/** Days the fact held (a state) or happened (an event). */
function factSpan(fact: FactRow, today: string): DayRange | null {
  if (fact.happenedStart) return { start: fact.happenedStart, end: fact.happenedEnd ?? fact.happenedStart };
  const from = factDay(fact);
  if (!from) return null;
  return { start: from, end: fact.validUntil && fact.validUntil < today ? fact.validUntil : today };
}

function wordHits(terms: readonly string[], fact: FactRow): number {
  const words = `${fact.text} ${fact.keys}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return terms.filter((term) => words.some((word) => word === term || (term.length >= 4 && word.length >= 4 && (word.startsWith(term.slice(0, -1)) || term.startsWith(word.slice(0, -1)))))).length;
}

/** The message names the fact's topic (its file name, title or an alias): a topic match counts on its own, as one word. */
function keyHit(terms: readonly string[], fact: FactRow): boolean {
  if (!fact.keys) return false;
  const words = fact.keys.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return terms.some((term) => words.includes(term) || words.includes(term.replace(/s$/, "")));
}

const TIME_WORDS = new Set("last this next year month week day days weeks months years ago spring summer autumn fall winter yesterday today since during january february march april may june july august september october november december".split(" "));

const QUESTION_WORDS = new Set("what who where when which why how whats".split(" "));

/** The message's searchable words, possessives folded ("Ana's" is "ana"). */
export function queryTerms(query: string): string[] {
  const out: string[] = [];
  for (const raw of recallTerms(query)) {
    const term = raw.replace(/['’]s$/u, "").replace(/['’]/gu, "");
    if (term.length < 2 || QUESTION_WORDS.has(term) || out.includes(term)) continue;
    out.push(term);
  }
  return out;
}

function ftsMatch(terms: readonly string[]): string | null {
  const usable = terms.filter((term) => /^[\p{L}\p{N}]+$/u.test(term));
  return usable.length ? usable.map((term) => `"${term}"`).join(" OR ") : null;
}

export async function recallFacts(input: FactRecallInput): Promise<{ facts: RecalledFact[]; searched: boolean }> {
  warmEmbedder();
  const owners = [...input.memoryIds];
  for (const id of input.memoryIds) syncWorkspaceFacts(id);
  if (input.about) {
    syncAboutFacts(input.about.owner, input.about.text);
    owners.push(input.about.owner);
  }
  void embedPendingFacts(owners);
  const time = queryTime(input.query, input.today);
  const statuses: FactStatus[] = time.past ? ["active", "superseded", "expired", "merged"] : ["active"];
  const all = factsOf(owners, statuses);
  if (!all.length) return { facts: [], searched: true };
  const byId = new Map(all.map((fact) => [fact.id, fact]));
  const terms = queryTerms(input.query);
  const content = terms.filter((term) => !TIME_WORDS.has(term));
  const need = content.length >= 5 ? 2 : 1;
  const lists: string[][] = [];

  const match = ftsMatch(terms);
  const lexical = match ? searchFactText(owners, match, statuses, CANDIDATES).filter((id) => byId.has(id) && (wordHits(content.length ? content : terms, byId.get(id)!) >= need || keyHit(content, byId.get(id)!))) : [];
  lists.push(lexical);

  const similarity = new Map<string, number>();
  if (embedderReady()) {
    const query = await embedQuery(input.query);
    if (query) {
      for (const [id, vector] of factVectors(owners, statuses)) similarity.set(id, cosine(query, vector));
      lists.push([...similarity.entries()].filter(([, s]) => s >= SIMILAR_WITH_WORDS).sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES).map(([id]) => id));
    }
  }

  const asked = new Set([...names(input.query).map((name) => name.toLowerCase()), ...content]);
  const known = new Map<string, string[]>();
  for (const fact of all) for (const name of names(fact.text)) known.set(name.toLowerCase(), [...(known.get(name.toLowerCase()) ?? []), fact.id]);
  const entity = [...asked].flatMap((name) => known.get(name) ?? []);
  lists.push([...new Set(entity)].sort((a, b) => byId.get(b)!.learnedAt - byId.get(a)!.learnedAt).slice(0, CANDIDATES));

  const inWindow = new Set<string>();
  if (time.range) {
    for (const fact of all) {
      const span = factSpan(fact, input.today);
      if (span && overlaps(span, time.range)) inWindow.add(fact.id);
    }
    lists.push([...inWindow].sort((a, b) => (similarity.get(b) ?? 0) - (similarity.get(a) ?? 0) || byId.get(b)!.learnedAt - byId.get(a)!.learnedAt).slice(0, CANDIDATES));
  }

  const fused = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));

  const lexicalSet = new Set(lexical);
  const entitySet = new Set(entity);
  const timeOnly = Boolean(time.range) && content.length <= 2;
  const loaded = loadedIdents(input.loaded ?? []);
  const today = Date.parse(`${input.today}T12:00:00Z`);
  const scored: RecalledFact[] = [];
  for (const [id, rrf] of fused) {
    const fact = byId.get(id)!;
    if (fact.status === "active" && loaded.has(fact.ident)) continue;
    const sim = similarity.get(id) ?? 0;
    const relevant = sim >= SIMILAR
      || (lexicalSet.has(id) && (sim >= SIMILAR_WITH_WORDS || (!similarity.size && (wordHits(content, fact) >= need || keyHit(content, fact))) || wordHits(content, fact) >= Math.min(2, content.length)))
      || (entitySet.has(id) && (sim >= SIMILAR_WITH_WORDS || !similarity.size || lexicalSet.has(id)))
      || (inWindow.has(id) && (timeOnly || lexicalSet.has(id) || sim >= SIMILAR_WITH_WORDS));
    if (!relevant) continue;
    const day = factDay(fact);
    const age = day ? Math.max(0, (today - Date.parse(`${day}T12:00:00Z`)) / 86_400_000) : RECENCY_DAYS;
    const recency = Math.max(0.1, 1 - age / RECENCY_DAYS);
    let score = rrf * (1 + 0.2 * (recency - 0.5));
    if (time.range) {
      const span = factSpan(fact, input.today);
      const near = span ? Math.max(0, 1 - daysOutside(span, time.range) / 180) : 0;
      score *= 1 + 0.2 * (near - 0.5);
    }
    if (fact.status !== "active") score *= time.range && inWindow.has(id) ? 1 : 0.8;
    if (fact.trust === "low") score *= 0.9;
    scored.push({ fact, score, past: fact.status !== "active" });
  }
  scored.sort((a, b) => b.score - a.score);
  // one fact said in two places (About me and a bot's notes) is recalled once
  const seen = new Set<string>();
  const facts = scored.filter((item) => (seen.has(item.fact.ident) ? false : (seen.add(item.fact.ident), true))).slice(0, MAX_FACTS);
  return { facts, searched: true };
}
