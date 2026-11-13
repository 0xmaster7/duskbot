import { z } from "zod";
import { costLine, type ResearchClient } from "./research.ts";
import { XResearchError } from "./x-research.ts";

export const WEB_SEARCH_NOT_CONFIGURED = "Web search is not configured.";
export const WEB_SEARCH_MAX_QUERIES = 10;
export const WEB_SEARCH_RESULTS = 5;
export const WEB_SEARCH_ENDPOINT = "perplexity.web.search.fast";

const inputSchema = z.object({ queries: z.array(z.string().trim().min(1).max(512)).min(1).max(WEB_SEARCH_MAX_QUERIES) });
const resultsSchema = z.object({ results: z.array(z.object({ title: z.string(), url: z.string().url(), snippet: z.string().optional().default("") })) });

/** How long one query's results are reused, for the same research credential: a model often repeats a search within a
 * task, and every search is paid. */
export const WEB_SEARCH_CACHE_MS = 20 * 60_000;
const CACHE_ENTRIES = 256;

type QueryAnswer = { query: string; results: Array<{ title: string; url: string; snippet: string }>; cost?: string; cached?: true; error?: string };

/** Answers by credential and query: a finished one is reused until it expires, and a running one is shared, so the same
 * query asked twice at once is paid once. A failed search is never kept. */
export class WebSearchCache {
  private readonly entries = new Map<string, { at: number; answer: Promise<QueryAnswer> }>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  answer(credential: string, query: string, run: () => Promise<QueryAnswer>): Promise<QueryAnswer> {
    const key = `${credential}\n${query.toLowerCase().replace(/\s+/g, " ")}`;
    const kept = this.entries.get(key);
    if (kept && this.now() - kept.at < WEB_SEARCH_CACHE_MS) {
      return kept.answer.then((answer) => (answer.error ? answer : { query, results: answer.results, cached: true as const }));
    }
    const answer = run();
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), answer });
    void answer.then((done) => { if (done.error && this.entries.get(key)?.answer === answer) this.entries.delete(key); });
    for (const [oldest] of this.entries) {
      if (this.entries.size <= CACHE_ENTRIES) break;
      this.entries.delete(oldest);
    }
    return answer;
  }
}

export async function webSearchMany(body: unknown, client: ResearchClient | null, researchOff?: () => void, cache?: { store: WebSearchCache; credential: string }) {
  if (!client) return { message: WEB_SEARCH_NOT_CONFIGURED };
  const input = inputSchema.safeParse(body);
  if (!input.success) throw new XResearchError("bad_input", "queries must contain 1 to 10 non-empty strings of at most 512 characters each.");
  const search = async (query: string): Promise<QueryAnswer> => {
    try {
      const answer = await client.call({ id: WEB_SEARCH_ENDPOINT, params: { query, search_type: "fast", max_results: WEB_SEARCH_RESULTS } });
      const parsed = resultsSchema.safeParse(answer.result);
      if (answer.upstreamFailed || !parsed.success) return { query, results: [], error: "Web search returned an unreadable answer. Try again shortly." };
      const cost = costLine(answer);
      return {
        query,
        results: parsed.data.results.filter((row) => row.url.length <= 2_048 && /^https?:\/\//i.test(row.url)).slice(0, WEB_SEARCH_RESULTS).map((row) => ({
          title: row.title.slice(0, 300), url: row.url, snippet: row.snippet.slice(0, 1_000),
        })),
        ...(cost ? { cost } : {}),
      };
    } catch (error) {
      if (error instanceof XResearchError && error.code === "off") {
        researchOff?.();
        return { query, results: [], error: WEB_SEARCH_NOT_CONFIGURED };
      }
      return { query, results: [], error: "Web search failed. Try again shortly." };
    }
  };
  const asked = new Map<string, Promise<QueryAnswer>>();
  const results = await Promise.all(input.data.queries.map((query) => {
    const same = asked.get(query.toLowerCase());
    if (same) return same.then(({ cost: _paidOnce, ...answer }) => ({ ...answer, query }));
    const answer = cache ? cache.store.answer(cache.credential, query, () => search(query)) : search(query);
    asked.set(query.toLowerCase(), answer);
    return answer;
  }));
  if (results.every((answer) => answer.error === WEB_SEARCH_NOT_CONFIGURED)) return { message: WEB_SEARCH_NOT_CONFIGURED };
  return { results };
}
