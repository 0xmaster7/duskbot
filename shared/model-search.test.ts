import { describe, expect, it } from "vitest";

import { capabilityBadges, contextLabel, priceLabel, searchModels, type SearchGroup } from "./model-search.ts";

const groups: SearchGroup[] = [
  { providerId: "openrouter", label: "OpenRouter", connected: false, words: ["router"], models: [
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", released: "2025-09-29", tools: true, vision: true },
    { id: "openai/gpt-5", name: "GPT-5", released: "2025-08-07" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", input: 0, output: 0 },
  ] },
  { providerId: "anthropic", label: "Anthropic", connected: true, instanceId: "claude", words: ["claude"], models: [
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", released: "2025-09-29" },
    { id: "claude-opus-4-1", name: "Claude Opus 4.1", released: "2025-08-05" },
  ] },
  { providerId: "groq", label: "Groq", connected: false, words: ["fast"], models: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    { id: "openai/gpt-oss-120b", name: "GPT OSS 120B" },
  ] },
];

describe("searchModels", () => {
  it("returns nothing for an empty query", () => {
    expect(searchModels(groups, "  ")).toEqual([]);
  });

  it("groups matches by provider with the connected provider first", () => {
    const hits = searchModels(groups, "sonnet");
    expect(hits.map((hit) => hit.group.providerId)).toEqual(["anthropic", "openrouter"]);
    expect(hits[0]!.models.map((model) => model.id)).toEqual(["claude-sonnet-4-5"]);
    expect(hits[0]!.group.instanceId).toBe("claude");
  });

  it("needs every word, across the model and its provider", () => {
    expect(searchModels(groups, "groq llama").map((hit) => hit.group.providerId)).toEqual(["groq"]);
    expect(searchModels(groups, "llama 70b").map((hit) => hit.group.providerId).sort()).toEqual(["groq", "openrouter"]);
    expect(searchModels(groups, "sonnet nonsense")).toEqual([]);
  });

  it("finds ids typed with dots, dashes or slashes either way", () => {
    expect(searchModels(groups, "claude-sonnet-4.5")[0]!.group.providerId).toBe("anthropic");
    expect(searchModels(groups, "gpt-oss")[0]!.models[0]!.id).toBe("openai/gpt-oss-120b");
  });

  it("puts an exact id ahead of a partial one", () => {
    const hit = searchModels(groups, "gpt-5").find((entry) => entry.group.providerId === "openrouter")!;
    expect(hit.models[0]!.id).toBe("openai/gpt-5");
  });

  it("lists a provider's models when its name or a word for it is searched", () => {
    expect(searchModels(groups, "fast")[0]!.group.providerId).toBe("groq");
    expect(searchModels(groups, "fast")[0]!.total).toBe(2);
  });

  it("caps each group and counts what it left out", () => {
    const many: SearchGroup = { providerId: "big", label: "Big", connected: false, models: Array.from({ length: 20 }, (_, i) => ({ id: `m-${i}`, name: `Model ${i}` })) };
    const [hit] = searchModels([many], "model", { perGroup: 5 });
    expect(hit!.models).toHaveLength(5);
    expect(hit!.total).toBe(20);
  });
});

describe("badges", () => {
  it("formats context windows and prices", () => {
    expect(contextLabel(200_000)).toBe("200K");
    expect(contextLabel(1_000_000)).toBe("1M");
    expect(contextLabel(1_048_576)).toBe("1M");
    expect(contextLabel(2_500_000)).toBe("2.5M");
    expect(contextLabel(undefined)).toBeUndefined();
    expect(priceLabel({ input: 3, output: 15 })).toBe("$3 / $15");
    expect(priceLabel({ input: 0.15, output: 0.6 })).toBe("$0.15 / $0.6");
    expect(priceLabel({ input: 0, output: 0 })).toBe("Free");
    expect(priceLabel({ input: 1 })).toBeUndefined();
  });

  it("names only the capabilities a model has", () => {
    expect(capabilityBadges({ id: "x", name: "x", tools: true, vision: false, reasoning: true })).toEqual(["tools", "reasoning"]);
  });
});
