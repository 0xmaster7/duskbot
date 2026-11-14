// The first-run funnel's order and its AI grid, kept free of React so both can be tested on their own.
import { BEAT_ORDER, type BeatId } from "@/lib/onboarding";
import { freeFallback } from "../../../shared/ai-ranking";

export const FUNNEL_STEPS = BEAT_ORDER;
export type FunnelStep = BeatId;

/** where the bots live, as the person picked it on the place step (none yet before that) */
export type FunnelPath = "mac" | "cloud";

export interface FunnelFacts {
  /** a dusk bot account can be signed in to from this window, and isn't yet */
  account: boolean;
  /** this is the desktop app's own window, where bots can live on this Mac, in dusk cloud or on a server */
  desktop: boolean;
  /** this window can bring in what other AI apps left on this computer (and offer the prompt for ones online) */
  bring?: boolean;
  /** where the person put the bots; dusk cloud signs in, picks a plan and pays in the browser, then ends on the cloud */
  path?: FunnelPath | null;
  /** the hello screen; false for a server opened from the desktop app, whose person has already met dusk bot there */
  hello?: boolean;
  /** the phone app is offered (phoneAppEnabled) */
  phone?: boolean;
}

/** The screens this person gets, in order. On the desktop app the first question is where the bots live (the hello is
 * part of it); this Mac goes on to the account (when there is none yet), an AI and what to bring; dusk cloud goes to the
 * browser for its account, plan and checkout, then an AI while the cloud is made, then the cloud. */
export function funnelSteps(facts: FunnelFacts): FunnelStep[] {
  const cloud = facts.desktop && facts.path === "cloud";
  return FUNNEL_STEPS.filter((step) => {
    if (step === "welcome") return facts.hello !== false && !facts.desktop;
    if (step === "place") return facts.desktop;
    if (step === "account") return facts.account && !cloud;
    if (step === "checkout") return cloud;
    if (step === "bring") return facts.desktop && Boolean(facts.bring) && !cloud;
    if (step === "phone") return Boolean(facts.phone) && facts.desktop && !cloud;
    if (step === "making") return cloud;
    return true;
  });
}

/** Where Next goes from `at`; null is the chat. */
export function nextStep(steps: readonly FunnelStep[], at: FunnelStep): FunnelStep | null {
  const index = steps.indexOf(at);
  return index >= 0 && index + 1 < steps.length ? steps[index + 1]! : null;
}

/** Back goes one screen back; once dusk cloud is paid for there is no way back to the purchase. */
export function previousStep(steps: readonly FunnelStep[], at: FunnelStep, { paid = false }: { paid?: boolean } = {}): FunnelStep | null {
  const index = steps.indexOf(at);
  const back = index > 0 ? steps[index - 1]! : null;
  return paid && back === "checkout" ? null : back;
}

/** dusk cloud is paid for: the account's own Cloud is being made, made, or its payment is linking. */
export function cloudBought(account: { purchase?: unknown; machine?: { status: string }; clouds?: Array<{ primary: boolean; runsOn: string; status: string }> } | null): boolean {
  if (!account) return false;
  if (account.purchase) return true;
  if (account.clouds?.some((entry) => entry.primary && entry.runsOn === "cloud" && (entry.status === "setting_up" || entry.status === "ready"))) return true;
  return account.machine?.status === "provisioning" || account.machine?.status === "ready";
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
  { id: "local", label: "Local model", ids: ["openaiCompat"], drivers: [] },
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
