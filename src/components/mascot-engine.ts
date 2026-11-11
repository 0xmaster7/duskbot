// the dusk bot engine: moods, reactions and springs for the bots in mascot-geometry, on one shared animation frame loop
// that sleeps whenever every bot on screen has settled
import { BODIES, FACES, INK, bodyName, botSvg, eyeD, mouthD, type BodyName } from "../../electron/mascot-geometry.mjs";

/** Every state a bot's mark can be asked to show. */
export const MARK_STATES = [
  "idle", "listening", "thinking", "streaming", "searching", "reading", "working", "coding", "running",
  "computing", "controlling", "waiting", "blocked", "finished", "failed", "sleeping", "waking", "happy",
  "excited", "laughing", "proud", "curious", "playful", "shy", "surprised", "suspicious", "angry",
  "confused", "sad", "drowsy", "bored", "scared", "celebrate", "approving", "orbit", "radar", "progress",
  "spawning", "loading", "dictating", "sending", "receiving", "uploading", "writing", "alerting", "bouncing",
  "powering-down", "humming", "notifying", "dragging", "logo", "showcase", "turntable",
] as const;
export type MarkState = (typeof MARK_STATES)[number];

/** App moments a mark answers with a short move. `open`: its bot was chosen. `tap`: the mark itself was double-clicked. */
export type MarkReaction = "hop" | "greet" | "startle" | "cheer" | "nod" | "spin" | "wiggle" | "lookAround" | "open" | "tap";
export type MarkPoke = "spin" | "bounce" | "nod";
export type MarkGaze = { x: number; y: number };

const P = ["x", "y", "r", "sx", "sy", "gx", "gy", "ls", "lt", "lb", "lr", "rs", "rt", "rb", "rr", "mw", "ms", "mo", "k"] as const;
type Param = (typeof P)[number];
// [stiffness, damping]: the body loose and bouncy, the face quick
const SPRING = P.map((_, i) => (i < 5 ? [420, 21] : i < 7 ? [260, 25] : i < 15 ? [1000, 52] : i < 18 ? [800, 44] : [140, 24]));
const I = Object.fromEntries(P.map((p, i) => [p, i])) as Record<Param, number>;

type StepValues = { [K in Param]?: number | null } & { e?: string | null; b?: 1 };
type Step = [number, StepValues?];

// reactions: steps of [ms from the start, spring targets to hold]. e holds a face, null hands a value back to the mood,
// b blinks; the last step ends it
const HOP: Step[] = [[0, { sy: 0.84, sx: 1.12, y: 1 }], [90, { sy: 1.14, sx: 0.9, y: -15, e: "happy" }], [260, { y: 0, sy: 1, sx: 1 }], [360, { sy: 0.88, sx: 1.1 }], [470, { sy: 1, sx: 1 }], [760, { e: null }], [800]];
const STARTLE: Step[] = [[0, { sy: 1.18, sx: 0.88, y: -7, e: "surprised" }], [220, { y: 0, sy: 1.04, sx: 0.97 }], [900, { sy: 1, sx: 1, e: null }], [960]];
const ACTS: Record<string, Step[]> = {
  hop: HOP,
  bounce: [[0, { sy: 0.9, sx: 1.06 }], [90, { y: -6, sy: 1.06, sx: 0.96 }], [220, { y: 0, sy: 1, sx: 1 }], [320]],
  nod: [[0, { gy: 0.7, sy: 0.95, y: 1.5, e: "content" }], [170, { gy: -0.1, sy: 1.02, y: 0 }], [330, { gy: 0.7, sy: 0.95, y: 1.5 }], [500, { gy: 0, sy: 1, y: 0 }], [760]],
  nudge: [[0, { gy: 0.6, sy: 0.96, y: 1 }], [180, { gy: null, sy: 1, y: 0 }], [360]],
  greet: [[0, { r: -12, sy: 1.05, e: "happy", b: 1 }], [150, { r: 10 }], [300, { r: -8 }], [450, { r: 5 }], [600, { r: 0, sy: 1 }], [1100]],
  wiggle: [[0, { r: -9, sy: 1.03 }], [110, { r: 8 }], [220, { r: -6 }], [330, { r: 0, sy: 1 }], [480]],
  startle: STARTLE,
  surprise: STARTLE,
  squish: [[0, { sy: 0.8, sx: 1.16 }], [120, { sy: 1, sx: 1, e: "happy" }], [620, { e: null }], [660]],
  twirl: [[0, { sy: 0.88, sx: 1.1 }], [80, { sx: -1, y: -12, sy: 1.08, e: "happy" }], [300, { sx: 0.8, y: 0, sy: 1 }], [420, { sy: 0.92, sx: 1.04 }], [540, { sy: 1, sx: 1 }], [900, { e: null }], [940]],
  dizzy: [[0, { e: "confused", r: -10 }], [180, { r: 9 }], [360, { r: -7 }], [540, { r: 5 }], [720, { r: 0 }], [1300, { e: null, b: 1 }], [1340]],
  open: [[0, { sy: 0.94, sx: 1.05, gy: -0.25, b: 1 }], [110, { sy: 1, sx: 1 }], [420, { gy: null }], [460]],
  perk: [[0, { sy: 1.1, sx: 0.93, y: -4, e: "surprised" }], [160, { y: 0, sy: 1, sx: 1 }], [520, { e: null, b: 1 }], [560]],
  stretch: [[0, { sy: 1.14, sx: 0.9, y: -2, e: "sleeping" }], [520, { sy: 0.94, sx: 1.06, y: 0, e: "drowsy" }], [720, { sy: 1, sx: 1 }], [900, { e: null, b: 1 }], [940]],
  huff: [[0, { x: -2.5, sy: 1.04 }], [60, { x: 2.5 }], [120, { x: -2 }], [180, { x: 1.5 }], [240, { x: 0, sy: 1 }], [300]],
  shake: [[0, { gx: -0.7 }], [140, { gx: 0.7 }], [280, { gx: -0.6 }], [420, { gx: 0.5 }], [560, { gx: null }], [640]],
  sigh: [[0, { sy: 1.04, gy: -0.3 }], [500, { sy: 0.93, sx: 1.04, gy: 0.3 }], [1200, { sy: 1, sx: 1, gy: null }], [1300]],
  peek: [[0, { gx: 0.4, gy: 0, b: 1 }], [700, { gx: null, gy: null }], [760]],
  laugh: [[0, { r: -5, y: -3, e: "laughing" }], [110, { r: 4, y: 0 }], [220, { r: -4, y: -3 }], [330, { r: 3, y: 0 }], [440, { r: 0 }], [900, { e: null }], [940]],
  celebrate: [...HOP.slice(0, -2), ...HOP.slice(0, -1).map(([t, v]): Step => [t + 480, v]), [1300]],
};
const REACTION_ACT: Record<MarkReaction | MarkPoke, string> = {
  hop: "hop", greet: "greet", startle: "startle", cheer: "celebrate", nod: "nod", spin: "twirl", wiggle: "wiggle",
  lookAround: "peek", open: "open", tap: "tap", bounce: "bounce",
};
const POKES: MarkPoke[] = ["spin", "bounce", "nod"];

type Look = "still" | "scan" | "read" | "away";
// a mood: f the face; br breathing [depth, s]; sway [deg, s]; bob [units, s]; g where the eyes rest; look how they
// wander; every [ms, act] repeats; enter plays once; next [mood, ms] moves on; blink scales the gap between blinks (0
// never); follow false ignores the pointer
interface Mood {
  f?: string; br?: [number, number]; sway?: [number, number]; bob?: [number, number]; shiver?: number;
  r?: number; y?: number; sx?: number; sy?: number; g?: [number, number]; look?: Look;
  every?: [number, string]; enter?: string; next?: [string, number]; blink?: number; follow?: boolean;
}
const MOODS: Record<string, Mood> = {
  idle: { br: [0.02, 3.2] },
  sleeping: { f: "sleeping", br: [0.045, 4.2], r: -5, y: 1.5, sy: 0.97, blink: 0, follow: false, look: "still" },
  waking: { f: "drowsy", enter: "stretch", next: ["idle", 1500] },
  drowsy: { f: "drowsy", br: [0.035, 4], sway: [4, 5], blink: 0.6, look: "still" },
  listening: { f: "listening", r: 4, every: [2600, "nudge"] },
  thinking: { f: "thinking", g: [0.55, -0.6], sway: [3, 3.4], follow: false, look: "still" },
  searching: { f: "searching", y: -1, look: "scan", follow: false },
  working: { f: "working", bob: [1.4, 0.42], look: "read", follow: false },
  excited: { f: "excited", br: [0.03, 0.9], every: [900, "bounce"], enter: "bounce" },
  surprised: { f: "surprised", sy: 1.04, enter: "startle" },
  suspicious: { f: "suspicious", r: -3, g: [-0.5, 0], look: "away" },
  angry: { f: "angry", sx: 1.05, sy: 0.96, every: [1800, "huff"], enter: "huff" },
  happy: { f: "happy", sway: [3, 1.8] },
  curious: { f: "curious", r: 9, y: -1 },
  confused: { f: "confused", sway: [7, 2.6], g: [0.2, -0.3] },
  bored: { f: "bored", g: [-0.6, 0.3], br: [0.03, 5], every: [5200, "sigh"], look: "still" },
  proud: { f: "proud", sy: 1.05, sx: 0.97, g: [0, -0.45], look: "still" },
  shy: { f: "shy", g: [-0.55, 0.5], r: -6, sx: 0.96, sy: 0.97, every: [3200, "peek"], follow: false, look: "still" },
  sad: { f: "sad", y: 2, sy: 0.95, sx: 1.03, g: [0, 0.4], br: [0.025, 4.4], look: "still" },
  laughing: { f: "laughing", bob: [2.2, 0.24], sway: [3, 0.48] },
  scared: { f: "scared", sy: 0.92, sx: 0.97, y: 2, shiver: 0.7, follow: false, look: "still" },
  playful: { f: "playful", sway: [6, 1.4], every: [2200, "bounce"] },
  celebrate: { f: "happy", every: [1500, "hop"], enter: "hop" },
  finished: { f: "happy", sway: [3, 1.8], enter: "hop" },
  notifying: { f: "happy", enter: "perk", every: [1800, "bounce"] },
  spawning: { f: "happy", enter: "greet" },
};
const MOOD_OF: Record<MarkState, string> = {
  idle: "idle", listening: "listening", thinking: "thinking", streaming: "working", searching: "searching",
  reading: "working", working: "working", coding: "working", running: "working", computing: "thinking",
  controlling: "working", waiting: "thinking", blocked: "curious", finished: "finished", failed: "sad",
  sleeping: "sleeping", waking: "waking", happy: "happy", excited: "excited", laughing: "laughing", proud: "proud",
  curious: "curious", playful: "playful", shy: "shy", surprised: "surprised", suspicious: "suspicious", angry: "angry",
  confused: "confused", sad: "sad", drowsy: "drowsy", bored: "bored", scared: "scared", celebrate: "celebrate",
  approving: "happy", orbit: "thinking", radar: "searching", progress: "working", spawning: "spawning",
  loading: "thinking", dictating: "listening", sending: "working", receiving: "listening", uploading: "working",
  writing: "working", alerting: "surprised", bouncing: "excited", "powering-down": "drowsy", humming: "happy",
  notifying: "notifying", dragging: "surprised", logo: "idle", showcase: "happy", turntable: "idle",
};
const moodKey = (state: string): string => (Object.hasOwn(MOODS, state) ? state : MOOD_OF[state as MarkState] ?? "idle");

/** The face a state settles on, for markup drawn before the engine runs. */
export function markFace(state: string | undefined): string {
  return MOODS[moodKey(state ?? "idle")]!.f ?? "idle";
}

/** The faces an older expression index picks, in its order. */
export const EXPRESSION_FACES = ["idle", "happy", "surprised", "sad", "drowsy", "suspicious", "content", "curious", "confused"] as const;

/** Breathing is under a pixel below this, so smaller marks skip it and settle. */
const BREATH_PX = 48;

const between = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const f2 = (v: number) => Math.round(v * 100) / 100;

let motionQuery: MediaQueryList | null | undefined;
function reducedPage(): boolean {
  if (motionQuery === undefined) {
    motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    motionQuery?.addEventListener?.("change", () => { for (const b of bots) b.pageStill(Boolean(motionQuery?.matches)); });
  }
  return Boolean(motionQuery?.matches);
}

interface Runner {
  el: Element;
  on: boolean;
  size: number;
  wakeAt: number;
  live(): boolean;
  tick(now: number, dt: number): boolean;
  pageStill(still: boolean): void;
}

// one loop for every bot: it runs only while some bot on screen is moving and the tab is visible, and otherwise sleeps
// until the next blink, glance or repeat any of them has due
const bots = new Set<Runner>();
let raf = 0, last = 0, timer: ReturnType<typeof setTimeout> | undefined, timerAt = Infinity;
function kick() {
  if (raf || (typeof document !== "undefined" && document.hidden)) return;
  if (timer) { clearTimeout(timer); timer = undefined; timerAt = Infinity; }
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function frame(now: number) {
  raf = 0;
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  let busy = false, wake = Infinity;
  for (const b of bots) {
    if (!b.live()) continue;
    if (b.wakeAt > now) { wake = Math.min(wake, b.wakeAt); continue; }
    if (b.tick(now, dt)) busy = true;
    else wake = Math.min(wake, b.wakeAt);
  }
  if (busy) raf = requestAnimationFrame(frame);
  else if (wake < Infinity && wake < timerAt) {
    if (timer) clearTimeout(timer);
    timerAt = wake;
    timer = setTimeout(() => { timer = undefined; timerAt = Infinity; kick(); }, Math.max(0, wake - performance.now()));
  }
}
let visibilityHooked = false;
let seen: IntersectionObserver | null | undefined;
function observer(): IntersectionObserver | null {
  if (!visibilityHooked && typeof document !== "undefined") {
    visibilityHooked = true;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
  }
  if (seen === undefined) {
    seen = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const b = (e.target as Element & { __duskBot?: Runner }).__duskBot;
        if (!b) continue;
        b.on = e.isIntersecting;
        if (b.on && !b.size) b.size = e.boundingClientRect.width;
        if (b.on) { b.wakeAt = 0; kick(); }
      }
    }, { rootMargin: "40px" }) : null;
  }
  return seen;
}

/** A look direction in -1..1 (x right, y down) for a pointer at (x, y), seen from a mark drawn in rect; null past reach px. */
export function pointerGaze(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, reach = 220): MarkGaze | null {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
  if (d > reach) return null;
  const pull = Math.min(1, d / Math.max(rect.width * 0.9, 36));
  return { x: f2((dx / d) * pull), y: f2((dy / d) * pull * 0.8) };
}

/** Where a mark looks for a pointer over or near it, at any distance. */
export function hoverGaze(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): MarkGaze {
  return pointerGaze(rect, x, y, Infinity)!;
}

export interface MarkOptions {
  body?: string;
  /** css colour for the body; otherwise it takes currentColor */
  colour?: string;
  /** eye and mouth colour, INK by default */
  eyes?: string;
  state?: string;
  /** drawn size in px; measured when left out */
  size?: number;
  /** animate only while on screen (default true) */
  observe?: boolean;
  /** true holds still, false moves whatever the page asks; left out, it follows prefers-reduced-motion */
  still?: boolean;
  /** false: no blinks or idle glances of its own */
  life?: boolean;
}

export interface Mark {
  readonly el: Element;
  readonly body: BodyName;
  readonly state: string;
  setState(state: string): void;
  react(kind: MarkReaction | MarkPoke | "blink"): void;
  /** spin, bounce and nod in turn when no kind is named */
  poke(kind?: MarkPoke): void;
  /** eyes and lean toward a direction in -1..1 (x right, y down), or null to look about on its own */
  lookAt(x: number | null, y?: number): void;
  blink(): void;
  /** a face held over the mood's own, or null to let it go */
  hold(face: string | null): void;
  setColour(colour: string | undefined): void;
  setEyes(eyes: string | undefined): void;
  setLife(life: boolean): void;
  setStill(still: boolean | undefined): void;
  setSize(size: number): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

/**
 * Brings a bot to life. target is an svg holding botSvg output (or empty, to draw one into); destroy() on unmount.
 */
export function createMark(target: SVGSVGElement, options: MarkOptions = {}): Mark {
  const { body, colour, eyes, state = "idle", size, observe = true } = options;
  const name = bodyName(body || target.getAttribute("data-body") || "circle");
  const el = target;
  if (!el.querySelector(".bb")) el.innerHTML = botSvg(name, markFace(state), eyes || INK);
  if (!el.getAttribute("viewBox")) el.setAttribute("viewBox", "0 0 100 100");
  if (colour) (el as unknown as ElementCSSInlineStyle).style.color = colour;

  const geo = BODIES[name], foot = geo.foot, [, , sp, er] = geo.face;
  const bb = el.querySelector(".bb")!, bg = el.querySelector(".bg")!;
  const [k1, k2, eL, eR, mouth] = Array.from(bg.firstElementChild!.children);
  const eyesEl = ([[eL!, -1], [eR!, 1]] as const).map(([g, side]) => [g, g.firstElementChild!, g.lastElementChild!, side] as const);
  const v = new Float64Array(P.length), vel = new Float64Array(P.length), tgt = new Float64Array(P.length);
  const written = new WeakMap<Element, Record<string, string>>();
  // writes an attribute only when it changed
  const put = (node: Element, attr: string, val: string) => {
    let vals = written.get(node);
    if (!vals) written.set(node, (vals = {}));
    if (vals[attr] === val) return;
    vals[attr] = val;
    node.setAttribute(attr, val);
  };

  let mood: Mood = MOODS.idle!, moodName = "", moodAt = 0, act: { steps: Step[]; i: number; t0: number } | null = null;
  let over: StepValues = {}, look: MarkGaze | null = null, glance: [number, number] | null = null, held: string | null = null;
  let nextBlink = 0, blinkAt = -1, blinkTwice = false, nextGlance = 0, nextEvery = 0, taps = 0, tapAt = 0, pokes = 0;
  let paused = false, pendingEnter: string | null = null, life = options.life ?? true, forced = options.still;
  let still = forced ?? reducedPage();

  const runner: Runner = {
    // on screen until the observer says otherwise
    el, on: true, size: size || 0, wakeAt: 0,
    live: () => runner.on && !paused && !still,
    tick,
    pageStill: (s) => { if (forced === undefined) setStillNow(s); },
  };
  (el as Element & { __duskBot?: Runner }).__duskBot = runner;

  const faceOf = () => FACES[over.e || held || mood.f || "idle"] || FACES.idle!;
  function targets() {
    const s = mood, fc = faceOf(), lE = fc.l, rE = fc.r || fc.l;
    // where the eyes go: a reaction, then the pointer, then a glance, then where the mood rests them
    let gx = s.g ? s.g[0] : 0, gy = s.g ? s.g[1] : 0;
    if (glance) [gx, gy] = glance;
    if (look && s.follow !== false) ({ x: gx, y: gy } = look);
    if (over.gx != null) gx = over.gx;
    if (over.gy != null) gy = over.gy;
    const base: Record<Param, number> = {
      x: gx * 1.5, y: s.y || 0, r: (s.r || 0) + gx * 5, sx: s.sx || 1, sy: s.sy || 1, gx, gy,
      ls: lE[0]!, lt: lE[1]!, lb: lE[2]!, lr: lE[3]!, rs: rE[0]!, rt: rE[1]!, rb: rE[2]!, rr: rE[3]!, mw: fc.m[0]!, ms: fc.m[1]!, mo: fc.m[2]!, k: fc.k,
    };
    for (let i = 0; i < P.length; i++) tgt[i] = over[P[i]!] ?? base[P[i]!];
  }
  function settle() {
    act = null; over = {}; pendingEnter = null; blinkAt = -1;
    targets();
    v.set(tgt); vel.fill(0);
    draw(0, 1);
  }
  function setStillNow(s: boolean) {
    still = s;
    settle();
    if (!s) wake();
  }
  function wake() { runner.wakeAt = 0; kick(); }

  function play(kind: string, now: number) {
    const steps = ACTS[kind];
    if (!steps) return;
    act = { steps, i: 0, t0: now };
    over = {};
  }
  function runAct(now: number) {
    if (!act) return;
    const t = now - act.t0;
    while (act && act.i < act.steps.length && act.steps[act.i]![0] <= t) {
      const step = act.steps[act.i++]![1];
      if (!step) {
        act = null; over = {};
        if (v[I.sx]! < 0) v[I.sx] = -v[I.sx]!;
        break;
      }
      for (const k of Object.keys(step) as (keyof StepValues)[]) {
        const value = step[k];
        if (k === "b") blinkAt = now;
        else if (value === null) delete over[k];
        else (over as Record<string, unknown>)[k] = value;
      }
    }
  }

  const glances = () => mood.look === "read" || mood.look === "scan" || mood.look === "away" || (life && mood.look !== "still");
  function schedule(now: number) {
    const s = mood, rate = life ? s.blink ?? 1 : 0;
    if (rate && now >= nextBlink) {
      if (nextBlink) { blinkAt = now; blinkTwice = Math.random() < 0.18; }
      nextBlink = now + between(2200, 6200) / rate;
    }
    if (s.next && now - moodAt > s.next[1]) return setMood(s.next[0], now);
    if (s.every && now >= nextEvery) { if (!act) play(s.every[1], now); nextEvery = now + s.every[0] * between(0.85, 1.25); }
    if (now >= nextGlance) {
      const mode = glances() ? s.look : "still";
      if (mode === "read") { glance = [glance && glance[0] < 0 ? 0.35 : -0.35, 0.5]; nextGlance = now + between(700, 1200); }
      else if (mode === "scan") { glance = [glance && glance[0] < 0 ? between(0.5, 0.85) : -between(0.5, 0.85), between(-0.3, 0.1)]; nextGlance = now + between(520, 900); }
      else if (mode === "away") { glance = glance ? null : [0.55, 0.1]; nextGlance = now + (glance ? between(350, 600) : between(1800, 3600)); }
      else if (mode === "still") { glance = null; nextGlance = Infinity; }
      else if (glance) { glance = null; nextGlance = now + between(2600, 7000); }
      else { glance = [f2(between(-0.7, 0.7)), f2(between(-0.45, 0.35))]; nextGlance = now + between(600, 1500); }
    }
  }
  function nextEvent(): number {
    const s = mood;
    let at = Infinity;
    if (life && (s.blink ?? 1)) at = Math.min(at, nextBlink);
    if (glances()) at = Math.min(at, nextGlance);
    if (s.every) at = Math.min(at, nextEvery);
    if (s.next) at = Math.min(at, moodAt + s.next[1]);
    return at;
  }
  const big = () => (runner.size || 40) >= BREATH_PX;
  const continuous = () => Boolean(mood.sway || mood.bob || mood.shiver || (mood.br && big()));

  function tick(now: number, dt: number): boolean {
    if (pendingEnter) { play(pendingEnter, now); pendingEnter = null; }
    schedule(now);
    runAct(now);
    targets();
    // springs, in steps small enough to stay steady at any frame rate
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    let resting = true;
    for (let s = 0; s < steps; s++) for (let i = 0; i < P.length; i++) {
      const [k, c] = SPRING[i]!;
      vel[i]! += (k! * (tgt[i]! - v[i]!) - c! * vel[i]!) * h;
      v[i]! += vel[i]! * h;
    }
    for (let i = 0; i < P.length && resting; i++) resting = Math.abs(tgt[i]! - v[i]!) < 0.002 && Math.abs(vel[i]!) < 0.02;
    if (resting) { v.set(tgt); vel.fill(0); }
    const blink = blinkOf(now);
    draw(now, blink);
    const active = Boolean(act) || blinkAt >= 0 || !resting || continuous();
    if (!active) runner.wakeAt = nextEvent();
    return active;
  }
  function blinkOf(now: number) {
    if (blinkAt < 0) return 1;
    const p = (now - blinkAt) / 150;
    if (p >= 1) {
      if (blinkTwice) { blinkTwice = false; blinkAt = now + 60; return 1; }
      blinkAt = -1;
      return 1;
    }
    return p < 0 ? 1 : Math.pow(Math.abs(1 - 2 * p), 1.4);
  }

  function draw(now: number, blink: number) {
    const s = mood, t = now / 1000;
    let x = v[I.x]!, y = v[I.y]!, r = v[I.r]!, sx = v[I.sx]!, sy = v[I.sy]!;
    if (!still) {
      if (s.br && big()) { const w = Math.sin((t * Math.PI * 2) / s.br[1]) * s.br[0]; sy += w; sx -= w * 0.5; }
      if (s.sway) r += Math.sin((t * Math.PI * 2) / s.sway[1]) * s.sway[0];
      if (s.bob) y -= Math.abs(Math.sin((t * Math.PI) / s.bob[1])) * s.bob[0];
      if (s.shiver) x += Math.sin(t * 57) * s.shiver;
    }
    const gx = v[I.gx]!, gy = v[I.gy]!;
    // looking aside turns the bot a little: the face slides over and the body narrows
    sx *= 1 - 0.06 * Math.min(1, Math.abs(gx));
    const moved = Math.abs(x) + Math.abs(y) + Math.abs(r) + Math.abs(sx - 1) + Math.abs(sy - 1) > 0.002;
    put(bb, "transform", moved ? `translate(${f2(50 + x)} ${f2(foot + y)}) rotate(${f2(r)}) scale(${f2(sx * 1000) / 1000} ${f2(sy * 1000) / 1000}) translate(-50 ${-foot})` : "translate(0 0)");
    put(bg, "transform", `translate(${f2(gx * 8)} ${f2(gy * 5)})`);
    const squeeze = 1 - 0.08 * Math.min(1, Math.abs(gx));
    for (const [g, path, hl, side] of eyesEl) {
      const o = side < 0 ? 0 : 4, es = v[I.ls + o]!, et = v[I.lt + o]!, eb = v[I.lb + o]!, droop = v[I.lr + o]!;
      // a blink only closes an open eye; arches and sleeping curves keep their shape
      const open = et > 0 && eb > 0, shut = open ? blink : 1;
      put(g, "transform", `translate(${f2(side * sp * squeeze)} 0) rotate(${f2(droop * side)}) scale(${f2(es * er * squeeze)} ${f2(es * er)})`);
      put(path, "d", open ? eyeD(f2(Math.max(0.08, et * shut)), f2(Math.max(0.08, eb * shut))) : eyeD(f2(et), f2(eb)));
      put(hl, "opacity", String(f2(clamp((Math.min(et, eb) * shut - 0.6) / 0.3, 0, 1))));
    }
    put(mouth!, "d", mouthD(v[I.mw]!, v[I.ms]!, v[I.mo]!));
    const blush = String(f2(clamp(v[I.k]!, 0, 1) * 0.55));
    put(k1!, "opacity", blush);
    put(k2!, "opacity", blush);
  }

  function setMood(next: string, now = performance.now()) {
    const key = moodKey(next);
    if (key === moodName) return;
    moodName = key; mood = MOODS[key]!; moodAt = now; glance = null; nextGlance = now + between(300, 900);
    nextEvery = now + (mood.every ? mood.every[0] : 0);
    if (still) return settle();
    if (mood.enter) pendingEnter = mood.enter;
    wake();
  }

  const handle: Mark = {
    el, body: name,
    get state() { return moodName; },
    setState(next) { setMood(next); },
    react(kind) {
      if (still || paused) return;
      const now = performance.now();
      if (kind === "blink") { blinkAt = now; return wake(); }
      let move = REACTION_ACT[kind];
      if (move === "tap") {
        taps = now - tapAt < 1300 ? taps + 1 : 1;
        tapAt = now;
        move = taps === 1 ? (Math.random() < 0.5 ? "squish" : "open") : taps === 2 ? "hop" : taps === 3 ? "twirl" : "dizzy";
      }
      if (!move) return;
      play(move, now);
      wake();
    },
    poke(kind) { handle.react(kind ?? POKES[pokes++ % POKES.length]!); },
    lookAt(x, y) {
      look = x == null ? null : { x: clamp(x, -1, 1), y: clamp(y ?? 0, -1, 1) };
      if (!still) wake();
    },
    blink() { if (!still) { blinkAt = performance.now(); wake(); } },
    hold(face) {
      held = face && Object.hasOwn(FACES, face) ? face : null;
      if (still) settle(); else wake();
    },
    setColour(next) { (el as unknown as ElementCSSInlineStyle).style.color = next ?? ""; },
    setEyes(next) {
      const ink = next || INK;
      for (const p of el.querySelectorAll(".bg path")) { p.setAttribute("fill", ink); if (p.hasAttribute("stroke")) p.setAttribute("stroke", ink); }
    },
    setLife(next) {
      if (next === life) return;
      life = next;
      if (!life) { glance = null; blinkAt = -1; }
      nextGlance = 0;
      if (!still) wake();
    },
    setStill(next) {
      forced = next;
      const s = next ?? reducedPage();
      if (s !== still) setStillNow(s);
    },
    setSize(next) { runner.size = next; },
    pause() { paused = true; },
    resume() { paused = false; wake(); },
    destroy() { bots.delete(runner); seen?.unobserve(el); delete (el as Element & { __duskBot?: Runner }).__duskBot; },
  };

  bots.add(runner);
  setMood(state);
  settle();
  if (mood.enter && !still) pendingEnter = mood.enter;
  if (observe) observer()?.observe(el);
  if (!still) wake();
  return handle;
}
