import { describe, expect, it } from "vitest";
import { aiName, aiTiles, freeModel, funnelSteps, nextStep, previousStep, skipsAi } from "./funnel";

const ai = (instanceId: string, driverKind: string, ready = false, extra: Record<string, unknown> = {}) => ({
  instanceId, driverKind, displayName: instanceId, access: "subscription", snapshot: { state: ready ? "available" : "unavailable", ...extra },
});
const ready = (instance: { snapshot: { state: string } }) => instance.snapshot.state === "available";

describe("the funnel's steps", () => {
  it("asks for an account only where one can be signed in, and where bots live only on the desktop app", () => {
    expect(funnelSteps({ account: true, desktop: true })).toEqual(["welcome", "account", "place", "ai", "bring", "phone"]);
    expect(funnelSteps({ account: false, desktop: false })).toEqual(["welcome", "ai"]);
  });

  it("passes over the AI step on the way forward when it has nothing to ask, but back still reaches it", () => {
    const steps = funnelSteps({ account: false, desktop: true });
    expect(nextStep(steps, "place", true)).toBe("bring");
    expect(nextStep(steps, "place", false)).toBe("ai");
    expect(previousStep(steps, "bring")).toBe("ai");
    expect(nextStep(steps, "phone", false), "the chat comes after the last").toBeNull();
  });
});

describe("the AI grid", () => {
  it("names each AI as people know it, in a fixed order, with only the ones this app can connect", () => {
    const tiles = aiTiles([ai("claude", "claudeAgent"), ai("chatgpt", "codex"), ai("antigravity", "antigravityAgent"), ai("openrouter", "openai-compat")], ready);
    expect(tiles.map((tile) => [tile.id, tile.label, tile.instance.instanceId])).toEqual([
      ["chatgpt", "ChatGPT", "chatgpt"], ["claude", "Claude", "claude"], ["gemini", "Gemini", "antigravity"], ["openrouter", "OpenRouter", "openrouter"],
    ]);
    expect(aiName({ instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" })).toBe("ChatGPT");
    expect(aiName({ instanceId: "kimi", driverKind: "kimiAgent", displayName: "Kimi" })).toBe("Kimi");
  });

  it("lets a signed-in one stand for its tile", () => {
    const tiles = aiTiles([ai("chatgpt", "codex"), ai("codex", "codex", true)], ready);
    expect(tiles[0]!.instance.instanceId).toBe("codex");
  });

  it("offers the free model only when it is ready", () => {
    expect(freeModel([ai("opencodeGo", "opencodeGo", true, { freeFallback: true })], ready)?.instanceId).toBe("opencodeGo");
    expect(freeModel([ai("opencodeGo", "opencodeGo", false, { freeFallback: true })], ready)).toBeUndefined();
  });

  it("skips the AI step only for a Claude account or a ChatGPT plan that answered", () => {
    expect(skipsAi({ instance: { driverKind: "claudeAgent", access: "subscription" }, state: "passed" })).toBe(true);
    expect(skipsAi({ instance: { driverKind: "codex", access: "subscription" }, state: "untestable" })).toBe(true);
    expect(skipsAi({ instance: { driverKind: "claudeAgent", access: "api" }, state: "passed" })).toBe(false);
    expect(skipsAi({ instance: { driverKind: "cursorAgent" }, state: "passed" })).toBe(false);
    expect(skipsAi({ instance: { driverKind: "claudeAgent" }, state: "testing" })).toBe(false);
    expect(skipsAi(null)).toBe(false);
  });
});
