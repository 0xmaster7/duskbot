import { describe, expect, it, vi } from "vitest";

import type { TextGenerationOptions } from "../contracts.ts";
import { PASS } from "./table.ts";
import { CLEAN_MAX_CHARS, CLEAN_TIMEOUT_MS, cleanedText, cleanupPrompt, createVoiceRoutes, type VoiceCleanInstance, type VoiceRouteDeps } from "./voice.ts";

const catalog = { default: "gpt-5.5", options: [{ id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-5.5-mini", label: "GPT-5.5 mini" }] };

function engine(instanceId: string, answer: (prompt: string, options?: TextGenerationOptions) => Promise<string> = async () => "Tidied.", extra: Partial<VoiceCleanInstance> = {}) {
  return { instanceId, driverKind: "codex", enabled: true, models: catalog, generateText: vi.fn(answer), ...extra } as VoiceCleanInstance & { generateText: ReturnType<typeof vi.fn> };
}

function routes(instances: VoiceCleanInstance[], deps: Partial<VoiceRouteDeps> = {}) {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance]));
  return createVoiceRoutes({
    instance: (id) => byId.get(id),
    helper: () => null,
    fallbacks: () => instances.map((instance) => instance.instanceId),
    refusal: () => undefined,
    ...deps,
  });
}

async function call(handler: ReturnType<typeof createVoiceRoutes>, body: unknown, method = "POST", path = "/api/voice/clean") {
  const answers: Array<[number, unknown]> = [];
  const out = await handler({
    req: {} as never, res: {} as never, url: new URL(`http://x${path}`), path, method,
    auth: { kind: "loopback", scopes: ["admin", "client"] },
    json: ((_res: unknown, status: number, value: unknown) => { answers.push([status, value]); }) as never, readBody: (async () => body) as never,
  });
  return { out, answers };
}

describe("voice clean-up route", () => {
  it("leaves every other path to the next route", async () => {
    const handler = routes([engine("codex")]);
    expect((await call(handler, {}, "GET")).out).toBe(PASS);
    expect((await call(handler, {}, "POST", "/api/voice/other")).out).toBe(PASS);
  });

  it("asks only for tidying, keeps the words inside the prompt, and answers with the text alone", async () => {
    const codex = engine("codex", async () => "<dictation>\nSo, what time is the meeting?\n</dictation>");
    const { answers } = await call(routes([codex]), { text: "um so what time is the uh meeting" });
    expect(answers).toEqual([[200, { text: "So, what time is the meeting?" }]]);
    const [prompt, options] = codex.generateText.mock.calls[0]!;
    expect(prompt).toContain("<dictation>\num so what time is the uh meeting\n</dictation>");
    for (const rule of ["punctuation", "capitalization", "filler words", "language", "never answer", "only"]) expect(prompt).toContain(rule);
    expect(options).toMatchObject({ timeoutMs: CLEAN_TIMEOUT_MS, model: "gpt-5.5-mini" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses empty or overlong text before any model runs", async () => {
    const codex = engine("codex");
    const handler = routes([codex]);
    expect((await call(handler, { text: "   " })).answers).toEqual([[400, { error: "text required" }]]);
    expect((await call(handler, {})).answers).toEqual([[400, { error: "text required" }]]);
    expect((await call(handler, { text: "a".repeat(CLEAN_MAX_CHARS + 1) })).answers[0]![0]).toBe(413);
    expect((await call(handler, { text: "a".repeat(CLEAN_MAX_CHARS) })).answers[0]![0]).toBe(200);
    expect(codex.generateText).toHaveBeenCalledTimes(1);
  });

  it("answers 409 when no connection can write", async () => {
    const off = engine("off", undefined, { enabled: false });
    const silent = { ...engine("silent"), generateText: undefined } as VoiceCleanInstance;
    const blocked = engine("blocked");
    const handler = routes([off, silent, blocked], { refusal: (instance) => (instance.instanceId === "blocked" ? "not allowed" : undefined) });
    const { answers } = await call(handler, { text: "hello there everyone", instanceId: "blocked" });
    expect(answers[0]![0]).toBe(409);
    expect(blocked.generateText).not.toHaveBeenCalled();
  });

  it("uses the chosen connection and model, else the helper, else the first that can write", async () => {
    const first = engine("first");
    const chosen = engine("chosen");
    const helper = engine("helper");
    const handler = routes([first, chosen, helper], { helper: () => ({ instanceId: "helper", model: "gpt-5.5" }) });
    await call(handler, { text: "hello there everyone", instanceId: "chosen", model: "gpt-5.5" });
    expect(chosen.generateText.mock.calls[0]![1]).toMatchObject({ model: "gpt-5.5" });
    await call(handler, { text: "hello there everyone", instanceId: "gone" });
    expect(helper.generateText.mock.calls[0]![1]).toMatchObject({ model: "gpt-5.5" });
    await call(routes([first, chosen]), { text: "hello there everyone" });
    expect(first.generateText).toHaveBeenCalledTimes(1);
  });

  it("never passes a model that could read as a flag, falling back to the quick one", async () => {
    const codex = engine("codex");
    await call(routes([codex]), { text: "hello there everyone", instanceId: "codex", model: "--dangerous" });
    expect(codex.generateText.mock.calls[0]![1]).toMatchObject({ model: "gpt-5.5-mini" });
  });

  it("answers 502 when the model fails or says nothing", async () => {
    expect((await call(routes([engine("codex", async () => { throw new Error("signed out"); })]), { text: "hello there" })).answers).toEqual([[502, { error: "signed out" }]]);
    expect((await call(routes([engine("codex", async () => "  ")]), { text: "hello there" })).answers[0]![0]).toBe(502);
  });

  it("builds a prompt and reads an answer without its wrapper or quotes", () => {
    expect(cleanupPrompt("hi")).toMatch(/<dictation>\nhi\n<\/dictation>$/);
    expect(cleanedText("“Hello, world.”")).toBe("Hello, world.");
    expect(cleanedText("  plain  ")).toBe("plain");
  });
});
