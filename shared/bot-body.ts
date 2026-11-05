/** Every body a bot can wear: the gradient catalog, the Grok-style catalog and the Halloween bodies. */

import { z } from "zod";

import { DEFAULT_MASCOT_BODY, MASCOT_BODY_IDS, type MascotBodyId } from "./mascot-bodies.ts";
import { GROK_BODIES, GROK_BODY_IDS, type GrokBody, type GrokBodyId } from "./grok-bodies.ts";
import { HALLOWEEN_BODY_IDS, type HalloweenBodyId } from "./halloween-bodies.ts";
import type { MausColor } from "./wire.ts";

const LEGACY_IDS: readonly string[] = MASCOT_BODY_IDS;

/** Grok-style ids that the older catalog does not already name. */
export const GROK_ONLY_BODY_IDS = GROK_BODY_IDS.filter((id) => !LEGACY_IDS.includes(id)) as Exclude<GrokBodyId, MascotBodyId>[];

export type BotBodyId = MascotBodyId | GrokBodyId | HalloweenBodyId;

export const BOT_BODY_IDS = [...MASCOT_BODY_IDS, ...GROK_ONLY_BODY_IDS, ...HALLOWEEN_BODY_IDS] as [BotBodyId, ...BotBodyId[]];

export const botBodySchema = z.enum(BOT_BODY_IDS);

/** Runtime-safe read of an untrusted persisted or streamed body id. */
export function botBodyId(value: unknown): BotBodyId {
  return botBodySchema.safeParse(value).data ?? DEFAULT_MASCOT_BODY;
}

export function isHalloweenBody(value: unknown): value is HalloweenBodyId {
  return (HALLOWEEN_BODY_IDS as readonly unknown[]).includes(value);
}

/** The Grok-style body every older body now draws as, so existing bots change look without a migration. */
export const GROK_LOOK_FOR_LEGACY: Record<MascotBodyId, GrokBodyId> = {
  cursor: "tablet",
  blob: "blob",
  circle: "blob",
  squircle: "squircle",
  capsule: "capsule",
  drop: "teardrop",
  shield: "shield",
  hexagon: "hex",
  diamond: "gem",
  star: "star",
};

/** The Grok-style body a stored id draws as. Unknown and missing ids wear the default. */
export function grokBodyFor(value: unknown): GrokBodyId {
  if (typeof value === "string" && Object.hasOwn(GROK_BODIES, value)) return value as GrokBodyId;
  if (typeof value === "string" && LEGACY_IDS.includes(value)) return GROK_LOOK_FOR_LEGACY[value as MascotBodyId];
  return GROK_LOOK_FOR_LEGACY[DEFAULT_MASCOT_BODY];
}

export function grokBody(value: unknown): GrokBody {
  return GROK_BODIES[grokBodyFor(value)];
}

/** Whether a bot wearing `current` draws as `id`, so a picker can mark "cursor" as the tablet it now looks like. */
export function wearsBody(current: unknown, id: BotBodyId): boolean {
  if (isHalloweenBody(id) || isHalloweenBody(current)) return current === id;
  return grokBodyFor(current) === grokBodyFor(id);
}

/** The costume each bot colour wears when "Dress my bots up" is on with the Halloween skin. */
export const COSTUME_FOR_COLOR: Record<Exclude<MausColor, "silver" | "chrome">, HalloweenBodyId> = {
  orange: "pumpkin",
  purple: "ghost",
  teal: "witch",
  red: "bat",
  blue: "cat",
  cyan: "skull",
  green: "monster",
  yellow: "mummy",
  coral: "vampire",
  pink: "spider",
};
