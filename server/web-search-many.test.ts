import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResearchClient } from "./research.ts";
import { XResearchError } from "./x-research.ts";
import { WebSearchCache, webSearchMany, WEB_SEARCH_CACHE_MS, WEB_SEARCH_ENDPOINT, WEB_SEARCH_NOT_CONFIGURED } from "./web-search-many.ts";

const row = { title: "Example", url: "https://example.com/", snippet: "A result." };
const clientWith = (call: ResearchClient["call"]): ResearchClient => ({ call, search: vi.fn(), endpoint: vi.fn() });

afterEach(() => vi.useRealTimers());

describe("web search batches", () => {
  it("finishes three slow searches in one search's time and preserves query order", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { result: { results: [row] }, costUsd: 0.001 };
    });
    const start = Date.now();
    const pending = webSearchMany({ queries: ["first", "second", "third"] }, clientWith(call));
    expect(call).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ results: ["first", "second", "third"].map((query) => ({ query, results: [row], cost: "$0.0010" })) });
    expect(Date.now() - start).toBe(100);
    expect(call).toHaveBeenCalledWith({ id: WEB_SEARCH_ENDPOINT, params: { query: "first", search_type: "fast", max_results: 5 } });
  });

  it("returns only bounded top results with title, url and snippet", async () => {
    const call = vi.fn(async () => ({ result: { results: [
      { ...row, title: "t".repeat(400), snippet: "s".repeat(2_000), extra: "omitted" },
      { title: "No snippet", url: "https://example.com/2" },
      { ...row, url: "javascript:alert(1)" },
      ...Array.from({ length: 8 }, () => row),
    ] } }));
    const answer = await webSearchMany({ queries: ["  query  "] }, clientWith(call));
    expect(answer.results?.[0]?.query).toBe("query");
    expect(answer.results?.[0]?.results).toHaveLength(5);
    expect(answer.results?.[0]?.results[0]).toEqual({ title: "t".repeat(300), url: row.url, snippet: "s".repeat(1_000) });
    expect(answer.results?.[0]?.results[1]).toEqual({ title: "No snippet", url: "https://example.com/2", snippet: "" });
  });

  it("accepts ten queries and rejects larger or invalid batches before any calls", async () => {
    const call = vi.fn(async () => ({ result: { results: [] } }));
    const client = clientWith(call);
    await webSearchMany({ queries: Array.from({ length: 10 }, (_, index) => `query ${index}`) }, client);
    expect(call).toHaveBeenCalledTimes(10);
    call.mockClear();
    for (const queries of [Array(11).fill("query"), [], [" "], [42], ["q".repeat(513)], "query", undefined]) {
      await expect(webSearchMany({ queries }, client)).rejects.toMatchObject({ code: "bad_input" });
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("returns one clear message without a configured client", async () => {
    expect(await webSearchMany({ queries: ["query"] }, null)).toEqual({ message: WEB_SEARCH_NOT_CONFIGURED });
  });

  it("keeps successful siblings and never exposes raw provider errors", async () => {
    const call = vi.fn<ResearchClient["call"]>().mockRejectedValueOnce(new Error("secret-provider-key"))
      .mockResolvedValueOnce({ result: { results: [row] } }).mockResolvedValueOnce({ result: { error: "secret-provider-key" } });
    const answer = await webSearchMany({ queries: ["failed", "ok", "malformed"] }, clientWith(call));
    expect(answer.results?.[0]).toMatchObject({ query: "failed", results: [], error: expect.any(String) });
    expect(answer.results?.[1]).toEqual({ query: "ok", results: [row] });
    expect(answer.results?.[2]).toMatchObject({ query: "malformed", results: [], error: expect.any(String) });
    expect(JSON.stringify(answer)).not.toContain("secret-provider-key");
  });

  it("marks unavailable research so subsequent tool lists can hide it", async () => {
    const off = vi.fn();
    const call = vi.fn<ResearchClient["call"]>().mockRejectedValue(new XResearchError("off", "private relay details"));
    expect(await webSearchMany({ queries: ["query"] }, clientWith(call), off)).toEqual({ message: WEB_SEARCH_NOT_CONFIGURED });
    expect(off).toHaveBeenCalledOnce();
  });

  it("pays once for a query asked twice in one batch, and charges only the first", async () => {
    const call = vi.fn(async () => ({ result: { results: [row] }, costUsd: 0.001 }));
    const answer = await webSearchMany({ queries: ["Notion pricing", "notion pricing"] }, clientWith(call));
    expect(call).toHaveBeenCalledTimes(1);
    expect(answer.results).toEqual([{ query: "Notion pricing", results: [row], cost: "$0.0010" }, { query: "notion pricing", results: [row] }]);
  });

  it("reuses a query's results for the same credential until they expire, and never keeps a failure", async () => {
    let now = 0;
    const store = new WebSearchCache(() => now);
    const call = vi.fn(async ({ params }: { params?: Record<string, unknown> }) => {
      if (params?.query === "broken") throw new Error("upstream");
      return { result: { results: [row] }, costUsd: 0.001 };
    });
    const client = clientWith(call as unknown as ResearchClient["call"]);
    await webSearchMany({ queries: ["keyboards", "broken"] }, client, undefined, { store, credential: "a" });
    expect(call).toHaveBeenCalledTimes(2);
    const again = await webSearchMany({ queries: ["Keyboards ", "broken"] }, client, undefined, { store, credential: "a" });
    expect(again.results?.[0]).toEqual({ query: "Keyboards", results: [row], cached: true });
    expect(call).toHaveBeenCalledTimes(3);
    await webSearchMany({ queries: ["keyboards"] }, client, undefined, { store, credential: "b" });
    expect(call).toHaveBeenCalledTimes(4);
    now = WEB_SEARCH_CACHE_MS;
    await webSearchMany({ queries: ["keyboards"] }, client, undefined, { store, credential: "a" });
    expect(call).toHaveBeenCalledTimes(5);
  });

  it("shares one running search between two batches asking the same query at once", async () => {
    const store = new WebSearchCache();
    let release!: () => void;
    const call = vi.fn(() => new Promise<{ result: unknown }>((resolve) => { release = () => resolve({ result: { results: [row] } }); }));
    const first = webSearchMany({ queries: ["same"] }, clientWith(call), undefined, { store, credential: "a" });
    const second = webSearchMany({ queries: ["same"] }, clientWith(call), undefined, { store, credential: "a" });
    await Promise.resolve();
    expect(call).toHaveBeenCalledTimes(1);
    release();
    expect((await first).results?.[0]?.results).toEqual([row]);
    expect((await second).results?.[0]).toMatchObject({ results: [row], cached: true });
  });
});
