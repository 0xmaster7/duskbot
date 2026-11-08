import { z } from "zod";
import { costLine, type ResearchClient } from "./research.ts";
import { XResearchError } from "./x-research.ts";

export const WEB_SEARCH_NOT_CONFIGURED = "Web search is not configured.";
export const WEB_SEARCH_MAX_QUERIES = 10;
export const WEB_SEARCH_RESULTS = 5;
export const WEB_SEARCH_ENDPOINT = "perplexity.web.search.fast";

const inputSchema = z.object({ queries: z.array(z.string().trim().min(1).max(512)).min(1).max(WEB_SEARCH_MAX_QUERIES) });
const resultsSchema = z.object({ results: z.array(z.object({ title: z.string(), url: z.string().url(), snippet: z.string().optional().default("") })) });

export async function webSearchMany(body: unknown, client: ResearchClient | null, researchOff?: () => void) {
  if (!client) return { message: WEB_SEARCH_NOT_CONFIGURED };
  const input = inputSchema.safeParse(body);
  if (!input.success) throw new XResearchError("bad_input", "queries must contain 1 to 10 non-empty strings of at most 512 characters each.");
  const results = await Promise.all(input.data.queries.map(async (query) => {
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
  }));
  if (results.every((answer) => answer.error === WEB_SEARCH_NOT_CONFIGURED)) return { message: WEB_SEARCH_NOT_CONFIGURED };
  return { results };
}
