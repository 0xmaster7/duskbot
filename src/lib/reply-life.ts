import type { MarkState } from "@/components/mascot-engine";

/** The start of a turn as the status line's mark lives it, as Grok Bot's does: the mark mounts as the bot itself, condenses
 * into the thinking dots once, and morphs back to the bot as the first words come. Every turn draws its spans from its
 * seed. */
export type LifeBeat = "mascot" | "dots";

/** The mascot's moment after the mark mounts, then the one pass of the dots. */
export const LIFE_MASCOT_MS = { min: 430, max: 600 } as const;
export const LIFE_DOTS_MS = { min: 400, max: 700 } as const;
/** The mark plays the mascot beat as this state; the dots are the engine's own morph, the thinking state. */
export const LIFE_MASCOT_STATE: MarkState = "listening";
export const LIFE_DOTS_STATE: MarkState = "thinking";

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  // fnv's low bits barely move with the last characters: mix them through before taking a parity or a remainder
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

/** A span inside `range`, the same for the same seed and salt. */
export function lifeDraw(seed: string, salt: string, range: { min: number; max: number }): number {
  return range.min + (hash(`${seed}|life|${salt}`) % (range.max - range.min + 1));
}

/** How long beat `index` lasts: the mascot, then the dots; the mascot after them stays. */
export function lifeSpan(seed: string, index: number): number {
  if (index === 0) return lifeDraw(seed, "0", LIFE_MASCOT_MS);
  if (index === 1) return lifeDraw(seed, "1", LIFE_DOTS_MS);
  return Infinity;
}

/** Where a turn `elapsedMs` after its mark mounted stands: its beat and the elapsed time the next one starts. The reply
 * being written (`typing`) is the bot itself, never the dots. */
export function lifeAt(seed: string, elapsedMs: number, typing = false): { beat: LifeBeat; nextAtMs: number } {
  if (typing) return { beat: "mascot", nextAtMs: Infinity };
  const at = Math.max(0, elapsedMs);
  const mascot = lifeSpan(seed, 0), dots = lifeSpan(seed, 1);
  if (at < mascot) return { beat: "mascot", nextAtMs: mascot };
  if (at < mascot + dots) return { beat: "dots", nextAtMs: mascot + dots };
  return { beat: "mascot", nextAtMs: Infinity };
}

/** The state the mark plays for a beat. Only the quiet wait lives this way (its base is thinking); a reply being written
 * (streaming) or a named step keeps its own state. */
export function lifeMarkState(base: MarkState, beat: LifeBeat | null | undefined): MarkState {
  if (!beat || base !== "thinking") return base;
  return beat === "mascot" ? LIFE_MASCOT_STATE : LIFE_DOTS_STATE;
}
