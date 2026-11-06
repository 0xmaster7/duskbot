import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.ts";
import { gatewayBackend } from "./gateway.ts";
import { createGatewayModelCatalog, gatewayModels } from "./gateway-models.ts";
import { createDecider, deciderPatchKey, deciderSavePatch, describeDecider } from "./index.ts";

const KEY = "vck_unit_gateway_key_0123456789";
const QUESTIONS = { answer: { type: "choice" as const, instructions: "Who answers?", options: { a: "Ada", b: "Bo" } } };

const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
const sent = (fetchImpl: ReturnType<typeof reply>, index = 0) => {
  const [url, init] = fetchImpl.mock.calls[index] as unknown as [URL, RequestInit];
  return { url: String(url), auth: (init.headers as Record<string, string>).authorization, body: JSON.parse(String(init.body)) };
};

describe("Vercel AI Gateway backend", () => {
  it("asks a decision model at the TypeSafe-compatible systemone with the model named and the key as a bearer", async () => {
    const fetchImpl = reply({ model: "typesafe-ai/jev", answers: { answer: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 } } } });
    const result = await gatewayBackend.decide({ key: KEY, state: { text: "hi" }, questions: QUESTIONS, signal: new AbortController().signal, fetch: fetchImpl });
    expect(result).toMatchObject({ ok: true, answers: { answer: { choice: "a", pTop: 0.9 } } });
    const call = sent(fetchImpl);
    expect(call.url).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    expect(call.auth).toBe(`Bearer ${KEY}`);
    expect(call.body.model).toBe("typesafe-ai/jev");
    expect(call.body.questions.answer).toEqual({ type: "choice", instructions: "Who answers?", criteria: { a: "Ada", b: "Bo" } });
  });

  it("asks a language model through chat completions with a strict schema and no OpenRouter routing field", async () => {
    const fetchImpl = reply({ model: "openai/gpt-5-nano", choices: [{ message: { content: JSON.stringify({ answers: { answer: { choice: "b", probabilities: { a: 0.2, b: 0.8 } } } }) } }] });
    const result = await gatewayBackend.decide({ key: KEY, model: "openai/gpt-5-nano", api: "chat", state: {}, questions: QUESTIONS, signal: new AbortController().signal, fetch: fetchImpl });
    expect(result).toMatchObject({ ok: true, answers: { answer: { choice: "b" } }, model: "openai/gpt-5-nano" });
    const call = sent(fetchImpl);
    expect(call.url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect(call.body.model).toBe("openai/gpt-5-nano");
    expect(call.body.response_format.type).toBe("json_schema");
    expect(call.body).not.toHaveProperty("provider");
  });

  it("maps a refused key to rejected and never sends it to plain http elsewhere", async () => {
    const refused = vi.fn(async () => new Response("{\"error\":\"bad key\"}", { status: 401 }));
    expect(await gatewayBackend.decide({ key: KEY, state: {}, questions: QUESTIONS, signal: new AbortController().signal, fetch: refused }))
      .toEqual({ ok: false, reason: "rejected", status: 401 });
    const never = vi.fn();
    expect(await gatewayBackend.decide({ key: KEY, baseUrl: "http://example.com", state: {}, questions: QUESTIONS, signal: new AbortController().signal, fetch: never }))
      .toEqual({ ok: false, reason: "misconfigured" });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("Vercel AI Gateway as the decider's provider", () => {
  const cfg: AppConfig = { decider: { enabled: true, provider: "gateway", gatewayKey: KEY, gatewayModel: "openai/gpt-5-nano", gatewayApi: "chat", key: "tsk_jev", jobs: { roomRouting: true } } };

  it("is used when picked, over a Jev key, and its status names the model but never the key", async () => {
    const status = describeDecider(cfg);
    expect(status).toEqual({ provider: "gateway", model: "openai/gpt-5-nano", api: "chat", configured: true, enabled: true, jobs: { roomRouting: true } });
    expect(JSON.stringify(status)).not.toContain(KEY);
    const fetchImpl = reply({ choices: [{ message: { content: JSON.stringify({ answers: { answer: { noul: 0.9 } } }) } }] });
    const result = await createDecider({ config: () => cfg, fetch: fetchImpl }).testKey();
    expect(result).toMatchObject({ ok: true, provider: "gateway" });
    expect(sent(fetchImpl).url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
  });

  it("tests a draft key at the gateway with the model it will save, and saving it turns decisions on", async () => {
    const fetchImpl = reply({ answers: { answer: { type: "noul", noul: 0.9 } } });
    await createDecider({ config: () => ({}), fetch: fetchImpl }).testKey({ key: KEY, provider: "gateway" });
    expect(sent(fetchImpl).url).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    expect(sent(fetchImpl).auth).toBe(`Bearer ${KEY}`);
    expect(deciderPatchKey({ provider: "gateway", gatewayKey: ` ${KEY} `, gatewayModel: "openai/gpt-5-nano", gatewayApi: "chat" }, undefined))
      .toEqual({ provider: "gateway", check: { key: KEY, provider: "gateway", model: "openai/gpt-5-nano", api: "chat" } });
    expect(deciderPatchKey({ gatewayKey: KEY }, undefined)).toEqual({ provider: "gateway", check: { key: KEY, provider: "gateway", model: "typesafe-ai/jev", api: "decisions" } });
    expect(deciderSavePatch({ provider: "gateway", gatewayKey: KEY }, undefined)).toMatchObject({ ok: true, patch: { enabled: true, jobs: { roomRouting: true } } });
  });
});

describe("the gateway's model list", () => {
  const listed = {
    data: [
      { id: "openai/gpt-5-nano", name: "GPT-5 nano", type: "language", supported_parameters: ["response_format"] },
      { id: "openai/gpt-5-nano-batch", name: "GPT-5 nano batch", type: "language", supported_parameters: ["response_format"] },
      { id: "acme/no-schema", name: "No schema", type: "language", supported_parameters: ["temperature"] },
      { id: "perplexity/pplx-decider-v1.2", name: "Decider", type: "evaluation" },
      { id: "typesafe-ai/jev", name: "Jev", type: "evaluation" },
      { id: "google/gemini-embedding-2", name: "Embedding", type: "embedding" },
    ],
  };

  it("lists decision models first (Jev on top), then language models that take a schema", () => {
    expect(gatewayModels(listed)).toEqual({
      source: "gateway",
      models: [
        { id: "typesafe-ai/jev", name: "Jev", group: "recommended", api: "decisions" },
        { id: "perplexity/pplx-decider-v1.2", name: "Decider", group: "recommended", api: "decisions" },
        { id: "openai/gpt-5-nano", name: "GPT-5 nano", group: "more", api: "chat" },
      ],
    });
  });

  it("reads the public list without a key and falls back to Jev alone when it fails", async () => {
    const fetchImpl = reply(listed);
    const list = await createGatewayModelCatalog({ fetch: fetchImpl }).load();
    expect(list.source).toBe("gateway");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://ai-gateway.vercel.sh/v1/models");
    expect(init.headers).not.toHaveProperty("authorization");
    const down = vi.fn(async () => new Response("", { status: 500 }));
    expect(await createGatewayModelCatalog({ fetch: down }).load()).toEqual({ source: "builtin", models: [{ id: "typesafe-ai/jev", name: "Jev", group: "recommended", api: "decisions" }] });
  });
});
