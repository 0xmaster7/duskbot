import type { MarkState } from "@/components/mascot-motion-mark";

/** The quiet wait between a send and the reply, as the status line's mark lives it: the bot as itself a while, then
 * condensed into the typing dots, then the reply. A long wait drifts between the two at its own pace. */
export type LifeBeat = "mascot" | "dots";

/** The first pass: the mascot's own moment, then the dots. Each turn draws its spans from its seed. */
export const LIFE_MASCOT_MS = { min: 900, max: 1800 } as const;
export const LIFE_DOTS_MS = { min: 600, max: 1400 } as const;
/** A long wait after the first pass: back to the mascot and on to the dots, each a little longer. */
export const LIFE_LOOP_MASCOT_MS = { min: 1400, max: 2600 } as const;
export const LIFE_LOOP_DOTS_MS = { min: 1800, max: 3600 } as const;
/** The mark plays the mascot beat as this state; the dots are the engine's own morph, the thinking state. */
export const LIFE_MASCOT_STATE: MarkState = "listening";
export const LIFE_DOTS_STATE: MarkState = "thinking";
/** About half the turns keep the quiet wait wordless; those show words only once the wait runs this long. */
export const LIFE_LATE_WORDS_MS = { min: 6000, max: 9000 } as const;
/** Past this many beats a wait just keeps alternating at loop pace, so a long turn costs nothing more per render. */
const MAX_DRAWN_BEATS = 64;

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

/** How long beat `index` lasts: even beats are the mascot, odd ones the dots. */
export function lifeSpan(seed: string, index: number): number {
  const mascot = index % 2 === 0;
  const first = index < 2;
  const range = mascot ? (first ? LIFE_MASCOT_MS : LIFE_LOOP_MASCOT_MS) : first ? LIFE_DOTS_MS : LIFE_LOOP_DOTS_MS;
  return lifeDraw(seed, String(Math.min(index, MAX_DRAWN_BEATS + (index % 2))), range);
}

/** Where a wait `elapsedMs` in stands: its beat and the elapsed time the next one starts. The reply being written
 * (`typing`) skips straight to the dots and holds them; the reply itself is never held back by any of this, it takes
 * the line's place in the frame it lands. */
export function lifeAt(seed: string, elapsedMs: number, typing = false): { beat: LifeBeat; nextAtMs: number } {
  if (typing) return { beat: "dots", nextAtMs: Infinity };
  const at = Math.max(0, elapsedMs);
  let start = 0;
  for (let index = 0; ; index++) {
    if (index === MAX_DRAWN_BEATS) {
      const pair = lifeSpan(seed, index) + lifeSpan(seed, index + 1);
      start += Math.floor((at - start) / pair) * pair;
    }
    const end = start + lifeSpan(seed, index);
    if (at < end) return { beat: index % 2 === 0 ? "mascot" : "dots", nextAtMs: end };
    start = end;
  }
}

/** The state the mark plays for a beat. Only the quiet wait lives this way (its base is thinking, or streaming while the
 * reply is written); a named step keeps its own state. */
export function lifeMarkState(base: MarkState, beat: LifeBeat | null | undefined): MarkState {
  if (!beat || (base !== "thinking" && base !== "streaming")) return base;
  return beat === "mascot" ? LIFE_MASCOT_STATE : LIFE_DOTS_STATE;
}

/** Whether this turn's quiet wait says anything early: about half do; the rest stay wordless unless the wait runs long. */
export function lifeSpeaks(seed: string): boolean {
  return hash(`${seed}|life|words`) % 2 === 0;
}
