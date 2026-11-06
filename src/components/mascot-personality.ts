// Our idle life and reactions for a mark, on top of Grok's state driver. Grok's idle marks stand still; ours blink,
// glance, stretch and doze off on a per-bot seeded schedule, so no two marks ever move together.
import { seededRandom, type MarkClip, type MarkPoke } from "./mascot-motion-engine";
import { OMB_CLIPS } from "./mascot-clips";

export type IdleAct =
  | "blink" | "doubleBlink" | "glance" | "lookAround" | "curious" | "fidget" | "stretch" | "yawn" | "hop" | "wiggle" | "nod";

export type MarkReaction = "hop" | "greet" | "startle" | "cheer" | "nod" | "spin" | "wiggle";

/** What the persona asks of the mark. The controller maps these onto Grok's animator. */
export interface PersonaBody {
  blink(): void;
  play(clip: MarkClip): void;
  poke(kind: MarkPoke, turns?: number): void;
  holdFace(face: string | null): void;
}

/** Weight is how often an act is picked among those off cooldown; cooldown is the least time between two of it. */
export const IDLE_ACTS: Record<IdleAct, { weight: number; cooldownMs: number }> = {
  blink: { weight: 30, cooldownMs: 0 },
  doubleBlink: { weight: 8, cooldownMs: 6_000 },
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

/** Gaps between idle acts: 2.5 s plus an exponential tail with a 5 s mean, at most 16 s. */
export const IDLE_GAP_MS = { min: 2_500, mean: 5_000, max: 16_000 } as const;
/** The first act after a mark comes to rest waits this long, so marks that rest together drift apart at once. */
export const FIRST_ACT_MS = { min: 1_500, max: 9_000 } as const;
/** Untouched this long, a mark dozes off; each bot draws its own time in the range. */
export const DOZE_AFTER_MS = { min: 60_000, max: 140_000 } as const;
/** A dozing mark breathes this often. */
export const DOZE_BREATH_MS = { min: 6_000, max: 11_000 } as const;
/** The same reaction twice inside this window plays once. */
export const REACTION_COOLDOWN_MS = 700;

const GROK_FIDGETS = ["Idle_A", "Idle_D"] as const;

export interface Persona {
  /** Runs what is due while the mark may idle, and says when it next needs a frame (Infinity: never on its own). */
  tick(now: number, canIdle: boolean): number;
  react(kind: MarkReaction, now: number): void;
  /** Hover, a poke or a new state: wakes a dozing mark and restarts the doze timer. */
  touch(now: number): void;
  readonly isDozing: boolean;
  /** The act played last, for the preview and the recordings. */
  readonly lastAct: string | null;
}

export function createPersona(seed: number, body: PersonaBody, clip: (name: string) => MarkClip): Persona {
  const random = seededRandom(seed ^ 0x5bd1e995);
  const between = (range: { min: number; max: number }) => range.min + random() * (range.max - range.min);
  const gap = () => Math.min(IDLE_GAP_MS.max, IDLE_GAP_MS.min - Math.log(1 - random()) * IDLE_GAP_MS.mean);
  const lastAt = new Map<string, number>();
  let nextAt: number | null = null;
  let touchedAt: number | null = null;
  let dozeAfter = between(DOZE_AFTER_MS);
  let dozing = false;
  let lastAct: string | null = null;

  const off = (name: string, cooldownMs: number, now: number) => now - (lastAt.get(name) ?? -Infinity) >= cooldownMs;
  const pick = (now: number): IdleAct => {
    const ready = (Object.keys(IDLE_ACTS) as IdleAct[]).filter((act) => off(act, IDLE_ACTS[act].cooldownMs, now));
    // the longer a mark sits untouched, the likelier it yawns or stretches
    const drowsy = touchedAt === null ? 1 : Math.min(2, 1 + (now - touchedAt) / dozeAfter);
    const weight = (act: IdleAct) => IDLE_ACTS[act].weight * (act === "yawn" || act === "stretch" ? drowsy : 1);
    let roll = random() * ready.reduce((sum, act) => sum + weight(act), 0);
    for (const act of ready) if ((roll -= weight(act)) < 0) return act;
    return "blink";
  };
  const perform = (act: IdleAct) => {
    lastAct = act;
    switch (act) {
      case "blink": return body.blink();
      case "doubleBlink": return body.play(OMB_CLIPS.DoubleBlink);
      case "glance": return body.play(random() < 0.5 ? OMB_CLIPS.GlanceLeft : OMB_CLIPS.GlanceRight);
      case "lookAround": return body.play(OMB_CLIPS.LookAround);
      case "curious": return body.play(clip("Working_B"));
      case "fidget": return body.play(clip(GROK_FIDGETS[Math.floor(random() * GROK_FIDGETS.length)]!));
      case "stretch": return body.play(OMB_CLIPS.Stretch);
      case "yawn": return body.play(OMB_CLIPS.Yawn);
      case "hop": return body.play(OMB_CLIPS.Hop);
      case "wiggle": return body.play(OMB_CLIPS.Wiggle);
      case "nod": return body.poke("nod");
    }
  };
  const wake = () => {
    if (!dozing) return;
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
    tick(now, canIdle) {
      if (!canIdle) {
        nextAt = null;
        return Infinity;
      }
      touchedAt ??= now;
      if (nextAt === null) {
        nextAt = now + between(FIRST_ACT_MS);
        return nextAt;
      }
      if (now < nextAt) return nextAt;
      if (dozing) {
        body.play(OMB_CLIPS.Breath);
        lastAct = "breath";
        nextAt = now + between(DOZE_BREATH_MS);
        return nextAt;
      }
      if (now - touchedAt >= dozeAfter) {
        dozing = true;
        body.play(OMB_CLIPS.DozeIn);
        body.holdFace("sleepy");
        lastAct = "doze";
        nextAt = now + between(DOZE_BREATH_MS);
        return nextAt;
      }
      const act = pick(now);
      lastAt.set(act, now);
      perform(act);
      nextAt = now + gap();
      return nextAt;
    },
    react(kind, now) {
      if (!off(`react:${kind}`, REACTION_COOLDOWN_MS, now)) return;
      lastAt.set(`react:${kind}`, now);
      const wasDozing = dozing;
      this.touch(now);
      if (wasDozing && kind !== "startle") return;
      lastAct = kind;
      switch (kind) {
        case "hop": return body.play(OMB_CLIPS.Hop);
        case "greet": return body.play(OMB_CLIPS.Greet);
        case "startle": return body.play(OMB_CLIPS.Startle);
        case "wiggle": return body.play(OMB_CLIPS.Wiggle);
        case "cheer": body.poke("spin"); return body.poke("bounce");
        case "nod": return body.poke("nod");
        case "spin": return body.poke("spin");
      }
    },
    touch(now) {
      touchedAt = now;
      dozeAfter = between(DOZE_AFTER_MS);
      // every mark of the page can be touched at once (a cue to all of them): each picks up again on its own beat
      if (nextAt !== null) nextAt = Math.max(nextAt, now + between({ min: IDLE_GAP_MS.min, max: IDLE_GAP_MS.min + IDLE_GAP_MS.mean }));
      wake();
    },
  };
}
