// How a mark answers its bot being clicked or opened. Grok's marks do nothing on a row select; only a tap on the
// status-line mark answers, cycling spin, bounce and nod as pokes that stack on whatever plays instead of restarting
// it (spin 0.9 s plus 0.4 s a turn, bounce 0.62 s, nod 0.5 s). Ours keep those pokes and add a weighted pool on top:
// each bot leans toward its own favourites, some clicks only get a quiet answer, and quick repeats escalate.
import { seededRandom, type MarkClip, type MarkPoke } from "./mascot-motion-engine";
import { DUSK_CLIPS, type OmbClipName } from "./mascot-clips";

/** `open`: the bot was chosen (a sidebar row, its chat opened). `tap`: the mark itself was double-clicked. */
export type ClickReaction = "open" | "tap";

export type ClickMove =
  | "blink" | "peek" | "nod" | "bounce" | "blinkSmile" | "curious" | "tilt" | "squish" | "perk" | "hop" | "wiggle" | "spin"
  | "greet";

export interface ClickMoveSpec {
  weight: number;
  /** A quiet answer: a blink, a glance, one of grok's small pokes. */
  subtle?: true;
  clip?: OmbClipName;
  pokes?: MarkPoke[];
}

export const CLICK_MOVES: Record<ClickMove, ClickMoveSpec> = {
  blink: { weight: 6, subtle: true },
  peek: { weight: 14, subtle: true, pokes: ["nod"] },
  nod: { weight: 10, subtle: true, pokes: ["nod"] },
  bounce: { weight: 12, subtle: true, pokes: ["bounce"] },
  blinkSmile: { weight: 10, subtle: true, clip: "BlinkSmile" },
  curious: { weight: 12, clip: "Curious" },
  tilt: { weight: 9, clip: "Tilt" },
  squish: { weight: 9, clip: "Squish" },
  perk: { weight: 7, clip: "Perk" },
  hop: { weight: 5, clip: "Hop" },
  wiggle: { weight: 4, clip: "Wiggle" },
  spin: { weight: 6, pokes: ["spin"] },
  greet: { weight: 2, clip: "Greet" },
};

const MOVES = Object.keys(CLICK_MOVES) as ClickMove[];
/** Grok's tap cycle, in its order. */
const GROK_TAP: MarkPoke[] = ["spin", "bounce", "nod"];

export const CLICK = {
  /** Two cues closer than this are one click: a row's select and the thread switch that follows it. */
  echoMs: 120,
  /** A click this soon after the last one escalates instead of starting over. */
  streakMs: 1_500,
  /** How often a click gets a quiet answer, give or take each bot's spread. */
  subtleChance: 0.35,
  subtleSpread: 0.12,
  /** Each bot's leaning: every move weighted by a seeded factor in this range, its favourites boosted on top. */
  affinity: [0.45, 1.55],
  favourites: 2,
  favouriteBoost: 2.5,
  /** A double-click on the mark leans toward grok's own tap pokes. */
  tapBias: 2,
  /** A peek looks toward the pointer's side (rows sit right of their mark) for a moment. */
  peek: { x: [0.3, 0.55], y: [-0.18, 0.08], holdMs: [650, 1_100] },
} as const;

export interface BotTaste {
  weights: Record<ClickMove, number>;
  subtleChance: number;
  favourites: ClickMove[];
}

/** A bot's own leaning, the same every time for the same seed. */
export function clickTaste(seed: number): BotTaste {
  const random = seededRandom(seed ^ 0x6a09e667);
  const [low, high] = CLICK.affinity;
  const weights = Object.fromEntries(MOVES.map((move) => [move, CLICK_MOVES[move].weight * (low + random() * (high - low))])) as Record<ClickMove, number>;
  const favourites: ClickMove[] = [];
  while (favourites.length < CLICK.favourites) {
    const move = MOVES[Math.floor(random() * MOVES.length)]!;
    if (favourites.includes(move)) continue;
    favourites.push(move);
    weights[move] *= CLICK.favouriteBoost;
  }
  const subtleChance = CLICK.subtleChance + (random() * 2 - 1) * CLICK.subtleSpread;
  return { weights, subtleChance, favourites };
}

export interface ClickBody {
  blink(): void;
  play(clip: MarkClip): void;
  poke(kind: MarkPoke, turns?: number): void;
  /** Looks toward a point, -1..1 with y down, and back ahead after holdMs. */
  peek(gaze: { x: number; y: number }, holdMs: number): void;
}

export interface ClickReactor {
  /** True for the second cue of one click, which should change nothing. */
  isEcho(now: number): boolean;
  /** Answers a click and says what it did. A dozing mark has already been woken with its stretch. */
  react(kind: ClickReaction, now: number, wasDozing: boolean): string;
  readonly streak: number;
}

export function createClickReactor(seed: number, body: ClickBody): ClickReactor {
  const taste = clickTaste(seed);
  // its own stream, so clicks do not reshuffle the idle acts
  const random = seededRandom(seed ^ 0x3c6ef372);
  const between = (range: readonly [number, number]) => range[0] + random() * (range[1] - range[0]);
  let lastAt = -Infinity;
  let streak = 0;
  let last: ClickMove | null = null;
  let beforeLast: ClickMove | null = null;
  let lastPoke: MarkPoke | null = null;
  let tapTurn = Math.floor(random() * GROK_TAP.length);

  const weight = (move: ClickMove, kind: ClickReaction) => {
    let value = taste.weights[move];
    if (kind === "tap" && CLICK_MOVES[move].pokes && move !== "peek") value *= CLICK.tapBias;
    // no a-b-a either: the one before last counts half
    if (move === beforeLast) value *= 0.5;
    return value;
  };
  const pick = (kind: ClickReaction, size: "subtle" | "big" | "any"): ClickMove => {
    const sized = MOVES.filter((move) => size === "any" || Boolean(CLICK_MOVES[move].subtle) === (size === "subtle"));
    const pool = sized.filter((move) => move !== last);
    let roll = random() * pool.reduce((sum, move) => sum + weight(move, kind), 0);
    const chosen = pool.find((move) => (roll -= weight(move, kind)) < 0) ?? pool[0]!;
    beforeLast = last;
    last = chosen;
    return chosen;
  };
  const poke = (kind: MarkPoke, turns = 1) => {
    lastPoke = kind;
    body.poke(kind, turns);
  };
  const perform = (move: ClickMove) => {
    const spec = CLICK_MOVES[move];
    if (move === "blink" || move === "peek") body.blink();
    if (move === "peek") {
      body.peek({ x: between(CLICK.peek.x), y: between(CLICK.peek.y) }, between(CLICK.peek.holdMs));
    }
    if (spec.clip) body.play(DUSK_CLIPS[spec.clip]);
    for (const kind of spec.pokes ?? []) poke(kind);
    return move;
  };
  /** Grok's next tap poke, never the one just played: pokes add onto whatever moves, so nothing restarts. */
  const layer = (gentle: boolean) => {
    const cycle = gentle ? GROK_TAP.filter((kind) => kind !== "spin") : GROK_TAP;
    let kind = cycle[tapTurn++ % cycle.length]!;
    if (kind === lastPoke) kind = cycle[tapTurn++ % cycle.length]!;
    poke(kind);
    return `poke:${kind}`;
  };

  return {
    get streak() {
      return streak;
    },
    isEcho: (now) => now - lastAt < CLICK.echoMs,
    react(kind, now, wasDozing) {
      streak = now - lastAt <= CLICK.streakMs ? streak + 1 : 0;
      lastAt = now;
      if (wasDozing) {
        streak = 0;
        return "stretch";
      }
      switch (streak) {
        case 0: return perform(pick(kind, random() < taste.subtleChance ? "subtle" : "big"));
        // the second click: one of grok's pokes on top, or a different, bigger move
        case 1: return random() < 0.55 ? layer(false) : perform(pick(kind, "big"));
        // the third: grok's happy twirl, two turns and a bounce
        case 2:
          poke("spin", 2);
          poke("bounce");
          return "twirl";
        case 3:
          body.play(DUSK_CLIPS.Dizzy);
          return "dizzy";
        // past dizzy it only nods and bobs, gently, until the clicks stop
        default: return layer(true);
      }
    },
  };
}
