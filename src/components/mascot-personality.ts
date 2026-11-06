// Our idle life and reactions for a mark, on top of Grok's state driver. Grok's idle marks stand still; ours blink,
// glance, stretch and doze off on a per-bot seeded schedule, so no two marks ever move together. blinks run on a track
// of their own and the eyes wander between acts, after threebot's character (MIT): see BLINK_GAP_MS and the peek act.
import { seededRandom, type MarkClip, type MarkPoke } from "./mascot-motion-engine";
import { OMB_CLIPS, type OmbClipName } from "./mascot-clips";

export type IdleAct =
  | "peek" | "glance" | "lookAround" | "curious" | "fidget" | "stretch" | "yawn" | "hop" | "wiggle" | "nod";

export type MarkReaction = "hop" | "greet" | "startle" | "cheer" | "nod" | "spin" | "wiggle" | "lookAround";

/** What the persona asks of the mark. The controller maps these onto Grok's animator. */
export interface PersonaBody {
  blink(): void;
  play(clip: MarkClip): void;
  poke(kind: MarkPoke, turns?: number): void;
  holdFace(face: string | null): void;
  /** Turns the mark toward a point, -1..1 with y down; null looks ahead again. */
  look(gaze: { x: number; y: number } | null): void;
}

/** Weight is how often an act is picked among those off cooldown; cooldown is the least time between two of it. */
export const IDLE_ACTS: Record<IdleAct, { weight: number; cooldownMs: number }> = {
  peek: { weight: 20, cooldownMs: 4_000 },
  glance: { weight: 18, cooldownMs: 5_000 },
  lookAround: { weight: 6, cooldownMs: 20_000 },
  curious: { weight: 5, cooldownMs: 15_000 },
  fidget: { weight: 7, cooldownMs: 25_000 },
  stretch: { weight: 4, cooldownMs: 45_000 },
  yawn: { weight: 3, cooldownMs: 60_000 },
  hop: { weight: 3, cooldownMs: 40_000 },
  wiggle: { weight: 3, cooldownMs: 40_000 },
  nod: { weight: 3, cooldownMs: 25_000 },
};

/** Gaps between idle acts: 3.5 s plus an exponential tail with a 5.5 s mean, at most 20 s. Blinks are not acts. */
export const IDLE_GAP_MS = { min: 3_500, mean: 5_500, max: 20_000 } as const;
/** Threebot's blink clock: the first blink 1 to 4 s after the mark comes to rest, then one every 2.2 to 5.8 s. */
export const BLINK_FIRST_MS = { min: 1_000, max: 4_000 } as const;
export const BLINK_GAP_MS = { min: 2_200, max: 5_800 } as const;
/** One blink in five is a double, the second 0.34 s after the first (threebot's object avatars). */
export const DOUBLE_BLINK_CHANCE = 0.2;
export const DOUBLE_BLINK_GAP_MS = 340;
/** A peek: the eyes (and with them grok's body) settle on a point near ahead, sometimes a second one, then come back. */
export const PEEK = { x: [0.22, 0.5], y: [-0.28, 0.18], holdMs: [700, 1_600], secondChance: 0.45, blinkChance: 0.3 } as const;
/** The first act after a mark comes to rest waits this long, so marks that rest together drift apart at once. */
export const FIRST_ACT_MS = { min: 1_500, max: 9_000 } as const;
/** Untouched this long, a mark dozes off; each bot draws its own time in the range. */
export const DOZE_AFTER_MS = { min: 60_000, max: 140_000 } as const;
/** A dozing mark breathes this often. */
export const DOZE_BREATH_MS = { min: 6_000, max: 11_000 } as const;
/** The same reaction twice inside this window plays once. */
export const REACTION_COOLDOWN_MS = 700;

const GROK_FIDGETS = ["Idle_A", "Idle_D"] as const;

/** One way to answer a moment: one of our clips, one of grok's, or pokes layered on whatever plays. */
export interface ReactionMove {
  weight: number;
  clip?: OmbClipName;
  grok?: string;
  pokes?: MarkPoke[];
}

/** Each reaction picks a weighted move, never the one it played last time, so the same moment reads fresh. */
export const REACTION_MOVES: Record<MarkReaction, ReactionMove[]> = {
  hop: [{ weight: 3, clip: "Hop" }, { weight: 2, pokes: ["bounce"] }, { weight: 1, clip: "Greet" }],
  greet: [{ weight: 3, clip: "Greet" }, { weight: 1, clip: "Hop" }],
  startle: [{ weight: 3, clip: "Startle" }, { weight: 2, clip: "Wince" }],
  cheer: [{ weight: 3, pokes: ["spin", "bounce"] }, { weight: 2, clip: "Wiggle" }, { weight: 2, clip: "Hop" }, { weight: 1, pokes: ["spin", "spin"] }],
  wiggle: [{ weight: 3, clip: "Wiggle" }, { weight: 1, clip: "Greet" }],
  nod: [{ weight: 3, pokes: ["nod"] }, { weight: 1, pokes: ["bounce"] }],
  spin: [{ weight: 1, pokes: ["spin"] }],
  lookAround: [{ weight: 3, clip: "LookAround" }, { weight: 2, clip: "GlanceLeft" }, { weight: 2, clip: "GlanceRight" }, { weight: 1, grok: "Working_B" }],
};

export interface Persona {
  /** Runs what is due while the mark may idle, and says when it next needs a frame (Infinity: never on its own). */
  tick(now: number, canIdle: boolean): number;
  /** Blinks what is due while the eyes are free (a held gaze does not stop them), and says when the next one is. */
  blinks(now: number, canBlink: boolean): number;
  react(kind: MarkReaction, now: number): void;
  /** Hover, a poke or a new state: wakes a dozing mark and restarts the doze timer. */
  touch(now: number): void;
  readonly isDozing: boolean;
  /** The act played last, for the preview and the recordings. */
  readonly lastAct: string | null;
  /** How many idle acts it has played. */
  readonly acts: number;
}

export function createPersona(seed: number, body: PersonaBody, clip: (name: string) => MarkClip): Persona {
  const random = seededRandom(seed ^ 0x5bd1e995);
  // its own stream, so blinking does not reshuffle the acts
  const blinkRandom = seededRandom(seed ^ 0x27d4eb2f);
  const between = (range: { min: number; max: number }) => range.min + random() * (range.max - range.min);
  const gap = () => Math.min(IDLE_GAP_MS.max, IDLE_GAP_MS.min - Math.log(1 - random()) * IDLE_GAP_MS.mean);
  const lastAt = new Map<string, number>();
  let nextAt: number | null = null;
  let touchedAt: number | null = null;
  let dozeAfter = between(DOZE_AFTER_MS);
  let dozing = false;
  let lastAct: string | null = null;
  let acts = 0;
  let blinkAt: number | null = null;
  let secondBlinkAt: number | null = null;
  // a peek's timed looks; the mark is turned while any is pending
  let looks: Array<{ at: number; gaze: { x: number; y: number } | null }> = [];
  let looking = false;
  const lookNow = (gaze: { x: number; y: number } | null) => {
    looking = gaze !== null;
    body.look(gaze);
  };
  const stopLooking = () => {
    looks = [];
    if (looking) lookNow(null);
  };
  const spot = () => ({
    x: (random() < 0.5 ? -1 : 1) * between({ min: PEEK.x[0], max: PEEK.x[1] }),
    y: between({ min: PEEK.y[0], max: PEEK.y[1] }),
  });
  const hold = () => between({ min: PEEK.holdMs[0], max: PEEK.holdMs[1] });
  /** Plans a peek from now and returns when it ends. */
  const peek = (now: number) => {
    let at = now;
    looks = [{ at, gaze: spot() }];
    at += hold();
    if (random() < PEEK.secondChance) {
      looks.push({ at, gaze: spot() });
      at += hold() * 0.7;
    }
    looks.push({ at, gaze: null });
    if (random() < PEEK.blinkChance) body.blink();
    return at;
  };
  const runLooks = (now: number) => {
    while (looks.length && looks[0]!.at <= now) lookNow(looks.shift()!.gaze);
    return looks.length ? looks[0]!.at : Infinity;
  };

  const lastMove = new Map<MarkReaction, ReactionMove>();
  let lastIdle: IdleAct | null = null;
  let lastFidget: string | null = null;
  const off = (name: string, cooldownMs: number, now: number) => now - (lastAt.get(name) ?? -Infinity) >= cooldownMs;
  const pick = (now: number): IdleAct => {
    const offCooldown = (Object.keys(IDLE_ACTS) as IdleAct[]).filter((act) => off(act, IDLE_ACTS[act].cooldownMs, now));
    // never the same act twice running
    const ready = offCooldown.length > 1 ? offCooldown.filter((act) => act !== lastIdle) : offCooldown;
    // the longer a mark sits untouched, the likelier it yawns or stretches
    const drowsy = touchedAt === null ? 1 : Math.min(2, 1 + (now - touchedAt) / dozeAfter);
    const weight = (act: IdleAct) => IDLE_ACTS[act].weight * (act === "yawn" || act === "stretch" ? drowsy : 1);
    let roll = random() * ready.reduce((sum, act) => sum + weight(act), 0);
    for (const act of ready) if ((roll -= weight(act)) < 0) return (lastIdle = act);
    return (lastIdle = ready[0] ?? "peek");
  };
  const fidget = () => {
    const pool = GROK_FIDGETS.filter((name) => name !== lastFidget);
    lastFidget = pool[Math.floor(random() * pool.length)]!;
    return lastFidget;
  };
  const move = (kind: MarkReaction) => {
    const all = REACTION_MOVES[kind];
    const last = lastMove.get(kind);
    const pool = all.length > 1 ? all.filter((option) => option !== last) : all;
    let roll = random() * pool.reduce((sum, option) => sum + option.weight, 0);
    const chosen = pool.find((option) => (roll -= option.weight) < 0) ?? pool[0]!;
    lastMove.set(kind, chosen);
    if (chosen.clip) body.play(OMB_CLIPS[chosen.clip]);
    if (chosen.grok) body.play(clip(chosen.grok));
    for (const poke of chosen.pokes ?? []) body.poke(poke);
  };
  const perform = (act: IdleAct, now: number) => {
    lastAct = act;
    switch (act) {
      case "peek": return peek(now);
      case "glance": return body.play(random() < 0.5 ? OMB_CLIPS.GlanceLeft : OMB_CLIPS.GlanceRight);
      case "lookAround": return body.play(OMB_CLIPS.LookAround);
      case "curious": return body.play(clip("Working_B"));
      case "fidget": return body.play(clip(fidget()));
      case "stretch": return body.play(OMB_CLIPS.Stretch);
      case "yawn": return body.play(OMB_CLIPS.Yawn);
      case "hop": return body.play(OMB_CLIPS.Hop);
      case "wiggle": return body.play(OMB_CLIPS.Wiggle);
      case "nod": return body.poke("nod");
    }
  };
  const wake = () => {
    if (!dozing) return;
    blinkAt = null;
    dozing = false;
    body.holdFace(null);
    body.play(OMB_CLIPS.Wake);
    lastAct = "wake";
  };

  return {
    get isDozing() {
      return dozing;
    },
    get lastAct() {
      return lastAct;
    },
    get acts() {
      return acts;
    },
    tick(now, canIdle) {
      if (!canIdle) {
        nextAt = null;
        stopLooking();
        return Infinity;
      }
      touchedAt ??= now;
      const nextLook = runLooks(now);
      if (nextAt === null) {
        nextAt = now + between(FIRST_ACT_MS);
        return Math.min(nextAt, nextLook);
      }
      if (now < nextAt) return Math.min(nextAt, nextLook);
      if (dozing) {
        body.play(OMB_CLIPS.Breath);
        lastAct = "breath";
        nextAt = now + between(DOZE_BREATH_MS);
        return nextAt;
      }
      if (now - touchedAt >= dozeAfter) {
        dozing = true;
        stopLooking();
        body.play(OMB_CLIPS.DozeIn);
        body.holdFace("sleepy");
        lastAct = "doze";
        nextAt = now + between(DOZE_BREATH_MS);
        return nextAt;
      }
      const act = pick(now);
      lastAt.set(act, now);
      acts++;
      const busyUntil = perform(act, now);
      nextAt = Math.max(now + gap(), typeof busyUntil === "number" ? busyUntil + IDLE_GAP_MS.min : 0);
      // an act's own clip blinks where it means to: the blink clock gives it room
      if (act !== "peek" && blinkAt !== null) blinkAt = Math.max(blinkAt, now + BLINK_GAP_MS.min);
      return Math.min(nextAt, runLooks(now));
    },
    blinks(now, canBlink) {
      // a dozing mark's lids are down, as threebot's sleeping pose turns its blink off
      if (!canBlink || dozing) {
        blinkAt = null;
        secondBlinkAt = null;
        return Infinity;
      }
      if (blinkAt === null) {
        blinkAt = now + BLINK_FIRST_MS.min + blinkRandom() * (BLINK_FIRST_MS.max - BLINK_FIRST_MS.min);
        return blinkAt;
      }
      if (secondBlinkAt !== null && now >= secondBlinkAt) {
        secondBlinkAt = null;
        body.blink();
      }
      if (now >= blinkAt) {
        body.blink();
        blinkAt = now + BLINK_GAP_MS.min + blinkRandom() * (BLINK_GAP_MS.max - BLINK_GAP_MS.min);
        if (blinkRandom() < DOUBLE_BLINK_CHANCE) secondBlinkAt = now + DOUBLE_BLINK_GAP_MS;
      }
      return Math.min(blinkAt, secondBlinkAt ?? Infinity);
    },
    react(kind, now) {
      if (!off(`react:${kind}`, REACTION_COOLDOWN_MS, now)) return;
      lastAt.set(`react:${kind}`, now);
      const wasDozing = dozing;
      this.touch(now);
      if (wasDozing && kind !== "startle") return;
      lastAct = kind;
      move(kind);
    },
    touch(now) {
      touchedAt = now;
      stopLooking();
      dozeAfter = between(DOZE_AFTER_MS);
      // every mark of the page can be touched at once (a cue to all of them): each picks up again on its own beat
      if (nextAt !== null) nextAt = Math.max(nextAt, now + between({ min: IDLE_GAP_MS.min, max: IDLE_GAP_MS.min + IDLE_GAP_MS.mean }));
      wake();
    },
  };
}
