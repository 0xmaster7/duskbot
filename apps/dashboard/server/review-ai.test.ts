import { expect, it } from "vitest";
import { REVIEW_AI, wireDemoAi } from "../scripts/review-ai.mjs";

function fakeHome() {
  const instances: Array<{ instanceId: string; displayName: string }> = [{ instanceId: "opencodeGo", displayName: "OpenCode" }];
  const bot = { id: "b1", modelSelection: { instanceId: "opencodeGo", model: "opencode/big-pickle" } as { instanceId: string; model: string } };
  const sent: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  async function call(path: string, init: { method?: string; body?: Record<string, unknown> } = {}) {
    const method = init.method ?? "GET";
    sent.push({ path, method, ...(init.body ? { body: init.body } : {}) });
    if (path === "/api/instances" && method === "GET") return { ok: true, status: 200, data: { instances } };
    if (path === "/api/instances/openai-compat" && method === "POST") {
      instances.push({ instanceId: "openai-compat:1", displayName: String(init.body!.displayName) });
      return { ok: true, status: 201, data: { instanceId: "openai-compat:1" } };
    }
    if (path.startsWith("/api/bots?")) return { ok: true, status: 200, data: { bots: [bot] } };
    if (path === "/api/bots/b1" && method === "PATCH") { bot.modelSelection = init.body!.modelSelection as typeof bot.modelSelection; return { ok: true, status: 200, data: { bot } }; }
    return { ok: false, status: 404, data: { error: "no route" } };
  }
  return { call, sent, bot };
}

it("says the key is missing and changes nothing without one", async () => {
  const home = fakeHome();
  expect(await wireDemoAi(home.call, { botId: "b1", key: null })).toEqual({ wired: false, reason: expect.stringContaining("missing DUSK_REVIEW_AI_OPENROUTER_KEY") });
  expect(home.sent).toEqual([]);
});

it("adds the OpenRouter engine once and points the demo bot at the cheap model, idempotently", async () => {
  const home = fakeHome();
  expect(await wireDemoAi(home.call, { botId: "b1", key: "sk-or-fake" })).toMatchObject({ wired: true, added: true, pointed: true, model: REVIEW_AI.model });
  expect(home.sent.find(item => item.method === "POST")?.body).toEqual({ displayName: "Demo AI", url: "https://openrouter.ai/api/v1", key: "sk-or-fake", models: ["openai/gpt-4o-mini"] });
  expect(home.bot.modelSelection).toEqual({ instanceId: "openai-compat:1", model: "openai/gpt-4o-mini" });
  const again = home.sent.length;
  expect(await wireDemoAi(home.call, { botId: "b1", key: "sk-or-fake" })).toMatchObject({ wired: true, added: false, pointed: false });
  expect(home.sent.slice(again).filter(item => item.method !== "GET")).toEqual([]);
});
