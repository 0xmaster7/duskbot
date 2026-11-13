// The first-run funnel's order and its AI grid, kept free of React so both can be tested on their own.
import { BEAT_ORDER, type BeatId } from "@/lib/onboarding";
import { freeFallback } from "../../../shared/ai-ranking";

export const FUNNEL_STEPS = BEAT_ORDER;
export type FunnelStep = BeatId;

export interface FunnelFacts {
  /** a dusk bot account can be signed in to from this window, and isn't yet */
  account: boolean;
  /** this is the desktop app's own window, where bots can live on this Mac, in dusk cloud or on a server */
  desktop: boolean;
  /** this window can bring in what other AI apps left on this computer (and offer the prompt for ones online) */
  bring?: boolean;
  /** a dusk cloud was bought in this run: the bots live there, so the run ends by waiting for it */
  cloud?: boolean;
  /** the hello screen; false for a server opened from the desktop app, whose person has already met dusk bot there */
  hello?: boolean;
}

/** The screens this person gets, in order. */
export function funnelSteps(facts: FunnelFacts): FunnelStep[] {
  return FUNNEL_STEPS.filter((step) => {
    if (step === "welcome") return facts.hello !== false;
    if (step === "account") return facts.account;
    if (step === "place") return facts.desktop;
    if (step === "bring") return facts.desktop && Boolean(facts.bring) && !facts.cloud;
    if (step === "phone") return facts.desktop && !facts.cloud;
    if (step === "making") return facts.desktop && Boolean(facts.cloud);
    return true;
  });
}

/** Where Next goes from `at`; null is the chat. */
export function nextStep(steps: readonly FunnelStep[], at: FunnelStep): FunnelStep | null {
  const index = steps.indexOf(at);
  return index >= 0 && index + 1 < steps.length ? steps[index + 1]! : null;
}

/** Back goes one screen back; the cloud being made has no way back to the purchase. */
export function previousStep(steps: readonly FunnelStep[], at: FunnelStep): FunnelStep | null {
  const index = steps.indexOf(at);
  return index > 0 ? steps[index - 1]! : null;
}

interface AiTileInstance {
  instanceId: string;
  driverKind: string;
  access?: string;
  snapshot: { state: string; authenticated?: boolean; freeFallback?: boolean };
}

export type AiTileId = "chatgpt" | "claude" | "grok" | "gemini" | "cursor" | "copilot" | "openrouter" | "local";

/** The grid's AIs, by what people call them, and the instances that are each one (the first listed wins). */
const TILES: ReadonlyArray<{ id: AiTileId; label: string; ids: readonly string[]; drivers: readonly string[] }> = [
  { id: "chatgpt", label: "ChatGPT", ids: ["chatgpt", "codex"], drivers: ["codex"] },
  { id: "claude", label: "Claude", ids: ["claude"], drivers: [] },
  { id: "grok", label: "Grok", ids: ["grok", "xaiApi"], drivers: ["grokAgent"] },
  { id: "gemini", label: "Gemini", ids: ["gemini", "antigravity"], drivers: ["geminiAgent", "antigravityAgent"] },
  { id: "cursor", label: "Cursor", ids: ["cursor"], drivers: ["cursorAgent"] },
  { id: "copilot", label: "GitHub Copilot", ids: ["githubCopilot"], drivers: ["copilotAgent"] },
  { id: "openrouter", label: "OpenRouter", ids: ["openrouter"], drivers: [] },
  { id: "local", label: "local model", ids: ["openaiCompat"], drivers: [] },
];

export interface AiTile<Instance> { id: AiTileId; label: string; instance: Instance }

/** The grid, in its fixed order, with only the AIs this app can connect here. */
export function aiTiles<Instance extends AiTileInstance>(instances: readonly Instance[], ready: (instance: Instance) => boolean): AiTile<Instance>[] {
  const tiles: AiTile<Instance>[] = [];
  for (const tile of TILES) {
    const byId = tile.ids.map((id) => instances.find((instance) => instance.instanceId === id)).filter(Boolean) as Instance[];
    const byDriver = instances.filter((instance) => tile.drivers.includes(instance.driverKind) && !byId.includes(instance));
    const candidates = [...byId, ...byDriver];
    // a signed-in one stands for the tile, else the first of its kind
    const instance = candidates.find(ready) ?? candidates[0];
    if (instance) tiles.push({ id: tile.id, label: tile.label, instance });
  }
  return tiles;
}

/** What people call this AI: the grid's name for it ("ChatGPT", not "ChatGPT plan"), else its own. */
export function aiName(instance: { instanceId: string; driverKind: string; displayName: string }): string {
  const tile = TILES.find((one) => one.ids.includes(instance.instanceId) || one.drivers.includes(instance.driverKind));
  return tile && tile.id !== "local" ? tile.label : instance.displayName;
}

/** The ready free model, if there is one: a way to start now and connect a better AI later. */
export function freeModel<Instance extends AiTileInstance>(instances: readonly Instance[], ready: (instance: Instance) => boolean): Instance | undefined {
  return instances.find((instance) => ready(instance) && freeFallback(instance));
}
