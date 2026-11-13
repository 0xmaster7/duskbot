import { describe, expect, it } from "vitest";
import { aiName, aiTiles, freeModel, funnelSteps, nextStep, previousStep } from "./funnel";

const ai = (instanceId: string, driverKind: string, ready = false, extra: Record<string, unknown> = {}) => ({
  instanceId, driverKind, displayName: instanceId, access: "subscription", snapshot: { state: ready ? "available" : "unavailable", ...extra },
});
const ready = (instance: { snapshot: { state: string } }) => instance.snapshot.state === "available";

describe("the funnel's steps", () => {
  it("asks for an account only where one can be signed in, and where bots live only on the desktop app", () => {
    expect(funnelSteps({ account: true, desktop: true })).toEqual(["welcome", "account", "place", "ai", "phone"]);
    expect(funnelSteps({ account: false, desktop: false })).toEqual(["welcome", "ai"]);
  });

  it("offers bringing bots in only when another app has some", () => {
    expect(funnelSteps({ account: false, desktop: true, bring: true })).toEqual(["welcome", "place", "ai", "bring", "phone"]);
  });

  it("ends a dusk cloud run on the cloud being made, never on this Mac's phone or bots", () => {
    const steps = funnelSteps({ account: false, desktop: true, bring: true, cloud: true });
    expect(steps).toEqual(["welcome", "place", "ai", "making"]);
    expect(nextStep(steps, "ai")).toBe("making");
    expect(nextStep(steps, "making"), "the chat comes after the last").toBeNull();
  });

  it("never passes over the AI step, so a connected AI still shows and more can be added", () => {
    const steps = funnelSteps({ account: false, desktop: true });
    expect(nextStep(steps, "place")).toBe("ai");
    expect(previousStep(steps, "phone")).toBe("ai");
    expect(nextStep(steps, "phone")).toBeNull();
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
});
