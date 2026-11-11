// the dusk bot engine: moods, reactions and springs for the bots in mascot-geometry, on one shared animation frame loop
// that sleeps whenever every bot on screen has settled
import { BODIES, FACES, INK, bodyName, botSvg, eyeD, type BodyName } from "../../electron/mascot-geometry.mjs";

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

const P = ["x", "y", "r", "sx", "sy", "gx", "gy", "ls", "lt", "lb", "lr", "rs", "rt", "rb", "rr", "es", "dm"] as const;
type Param = (typeof P)[number];
// [stiffness, damping]: the body loose and bouncy, the look critically damped (about 300 ms to settle), the eye shapes
// quick; es scales the eyes, dm melts the body into three dots
const SPRING = P.map((_, i) => (i < 5 ? [420, 21] : i < 7 ? [180, 27] : i < 15 ? [1000, 52] : i < 16 ? [600, 40] : [400, 40]));
const I = Object.fromEntries(P.map((p, i) => [p, i])) as Record<Param, number>;

// the head is a ball under the body: a look turns it, so the eyes slide round it and narrow toward the edge
const RAD = Math.PI / 180, YAW = 50, PITCH = 45, FACE_R = 30, FACE_RY = 24, SPIN_MS = 1300, DOT_MS = 460;

type StepValues = { [K in Param]?: number | null } & { e?: string | null; b?: 1; spin?: 1; swell?: 1 };
type Step = [number, StepValues?];

// reactions: steps of [ms from the start, spring targets to hold]. e holds a face, null hands a value back to the mood,
// b blinks, spin turns the head twice round, swell takes a slow breath; the last step ends it
const HOP: Step[] = [[0, { sy: 0.84, sx: 1.12, y: 1 }], [90, { sy: 1.14, sx: 0.9, y: -15, e: "happy" }], [260, { y: 0, sy: 1, sx: 1 }], [360, { sy: 0.88, sx: 1.1 }], [470, { sy: 1, sx: 1 }], [760, { e: null }], [800]];
const STARTLE: Step[] = [[0, { sy: 0.94, sx: 1.05, y: 2, es: 1.45, e: "surprised" }], [110, { sy: 1.16, sx: 0.9, y: -7 }], [300, { y: 0, sy: 1.04, sx: 0.97 }], [900, { sy: 1, sx: 1, es: null, e: null }], [960]];
const SPIN: Step[] = [[0, { spin: 1 }], [SPIN_MS]];
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
  spin: SPIN,
  twirl: SPIN,
  dizzy: [[0, { e: "confused", spin: 1 }], [1000, { r: -10 }], [1180, { r: 9 }], [1360, { r: -7 }], [1540, { r: 5 }], [1720, { r: 0 }], [2100, { e: null, b: 1 }], [2140]],
  open: [[0, { sy: 0.94, sx: 1.05, gy: -0.25, b: 1 }], [110, { sy: 1, sx: 1 }], [420, { gy: null }], [460]],
  perk: [[0, { sy: 1.1, sx: 0.93, y: -4, es: 1.3, e: "surprised" }], [160, { y: 0, sy: 1, sx: 1 }], [520, { es: null, e: null, b: 1 }], [560]],
  stretch: [[0, { sy: 1.14, sx: 0.9, y: -2, e: "sleeping" }], [520, { sy: 0.94, sx: 1.06, y: 0, e: "drowsy" }], [720, { sy: 1, sx: 1 }], [900, { e: null, b: 1 }], [940]],
  huff: [[0, { x: -2.5, sy: 1.04 }], [60, { x: 2.5 }], [120, { x: -2 }], [180, { x: 1.5 }], [240, { x: 0, sy: 1 }], [300]],
  shake: [[0, { gx: -0.7 }], [140, { gx: 0.7 }], [280, { gx: -0.6 }], [420, { gx: 0.5 }], [560, { gx: null }], [640]],
  sigh: [[0, { sy: 1.04, gy: -0.3 }], [500, { sy: 0.93, sx: 1.04, gy: 0.3 }], [1200, { sy: 1, sx: 1, gy: null }], [1300]],
  peek: [[0, { gx: 0.4, gy: 0, b: 1 }], [700, { gx: null, gy: null }], [760]],
  laugh: [[0, { r: -5, y: -3, e: "laughing" }], [110, { r: 4, y: 0 }], [220, { r: -4, y: -3 }], [330, { r: 3, y: 0 }], [440, { r: 0 }], [900, { e: null }], [940]],
  // a slow breath: 7% bigger over 800 ms, held 800 ms, let go over 900 ms
  swell: [[0, { swell: 1 }], [2500]],
  // a dip and squash, down in about 220 ms and back up over about 480 ms
  dip: [[0, { y: 3.5, sy: 0.95, sx: 1.05 }], [220, { y: 0, sy: 1, sx: 1 }], [700]],
  celebrate: [...HOP.slice(0, -2), ...HOP.slice(0, -1).map(([t, v]): Step => [t + 480, v]), [1300]],
};
const REACTION_ACT: Record<MarkReaction | MarkPoke, string> = {
  hop: "hop", greet: "greet", startle: "startle", cheer: "celebrate", nod: "nod", spin: "spin", wiggle: "wiggle",
  lookAround: "peek", open: "open", tap: "tap", bounce: "bounce",
};
const POKES: MarkPoke[] = ["spin", "bounce", "nod"];

type Look = "still" | "scan" | "read" | "away" | "work" | "type";
// a mood: f the face; br breathing [depth, s, 1 for an even swell]; fade dims the body with the breath; sway [deg, s];
// bob [units, s]; g where the eyes rest; look how they wander; lean how far the body follows the look; every [ms, act]
// repeats; fidget [ms, acts] picks one now and then on a big mark; enter plays once; next [mood, ms] moves on; blink
// scales the gap between blinks (0 never); follow false ignores the pointer; dots melts the body into three pulsing
// dots; zz lets z's rise; es scales the eyes
interface Mood {
  f?: string; br?: [number, number, number?]; fade?: number; sway?: [number, number]; bob?: [number, number]; shiver?: number;
  r?: number; y?: number; sx?: number; sy?: number; es?: number; g?: [number, number]; look?: Look; lean?: number;
  every?: [number, string]; fidget?: [number, string[]]; enter?: string; next?: [string, number]; blink?: number;
  follow?: boolean; dots?: boolean; zz?: boolean;
}
const MOODS: Record<string, Mood> = {
  idle: { br: [0.02, 3.2], fidget: [4200, ["swell", "swell", "spin"]] },
  sleeping: { f: "sleeping", br: [0.04, 2.4, 1], fade: 0.15, r: -5, y: 1.5, blink: 0, follow: false, look: "still", zz: true },
  waking: { f: "drowsy", enter: "stretch", next: ["idle", 1500] },
  drowsy: { f: "drowsy", br: [0.035, 4], sway: [4, 5], blink: 0.6, look: "still" },
  listening: { f: "listening", r: 4, every: [2600, "nudge"] },
  thinking: { f: "thinking", dots: true, follow: false, look: "still" },
  waiting: { f: "thinking", g: [0.45, -0.7], sway: [3, 3.4], follow: false, look: "still" },
  searching: { f: "searching", y: -1, look: "scan", lean: 0.6, follow: false },
  reading: { f: "working", look: "read", lean: 0.5, follow: false },
  working: { f: "working", look: "work", lean: 1, sway: [2, 2.6], every: [2600, "dip"], follow: false },
  writing: { f: "working", g: [-0.5, 0.55], look: "type", lean: 0.6, every: [1900, "dip"], follow: false },
  excited: { f: "excited", br: [0.03, 0.9], every: [900, "bounce"], enter: "spin" },
  surprised: { f: "surprised", es: 1.15, sy: 1.04, enter: "startle" },
  suspicious: { f: "suspicious", r: -3, g: [-0.5, 0], look: "away" },
  angry: { f: "angry", sx: 1.05, sy: 0.96, every: [1800, "huff"], enter: "huff" },
  happy: { f: "happy", sway: [3, 1.8], fidget: [3600, ["swell", "spin"]] },
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
  idle: "idle", listening: "listening", thinking: "thinking", streaming: "writing", searching: "searching",
  reading: "reading", working: "working", coding: "working", running: "working", computing: "thinking",
  controlling: "working", waiting: "waiting", blocked: "curious", finished: "finished", failed: "sad",
  sleeping: "sleeping", waking: "waking", happy: "happy", excited: "excited", laughing: "laughing", proud: "proud",
  curious: "curious", playful: "playful", shy: "shy", surprised: "surprised", suspicious: "suspicious", angry: "angry",
  confused: "confused", sad: "sad", drowsy: "drowsy", bored: "bored", scared: "scared", celebrate: "celebrate",
  approving: "happy", orbit: "thinking", radar: "searching", progress: "working", spawning: "spawning",
  loading: "thinking", dictating: "listening", sending: "working", receiving: "listening", uploading: "working",
  writing: "writing", alerting: "surprised", bouncing: "excited", "powering-down": "drowsy", humming: "happy",
  notifying: "notifying", dragging: "surprised", logo: "idle", showcase: "happy", turntable: "idle",
};
const moodKey = (state: string): string => (Object.hasOwn(MOODS, state) ? state : MOOD_OF[state as MarkState] ?? "idle");

/** The face a state settles on, for markup drawn before the engine runs. */
export function markFace(state: string | undefined): string {
  return MOODS[moodKey(state ?? "idle")]!.f ?? "idle";
}

/** The faces an older expression index picks, in its order. */
export const EXPRESSION_FACES = ["idle", "happy", "surprised", "sad", "drowsy", "suspicious", "content", "curious", "confused"] as const;

/** Breathing is under a pixel below this, so smaller marks skip it, the idle fidgets and the z's, and settle. */
const BREATH_PX = 48;

const between = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const f2 = (v: number) => Math.round(v * 100) / 100;
const smooth = (p: number) => p * p * (3 - 2 * p);
const inOut = (p: number) => (p < 0.5 ? 16 * Math.pow(p, 5) : 1 - Math.pow(-2 * p + 2, 5) / 2);

// the extra parts a moving mark needs: three dots to melt into and three z's to sleep under
const DOTS = '<g class="bd" opacity="0" fill="currentColor"><circle r="7"/><circle r="7"/><circle r="7"/></g>';
const ZZZ = '<g class="bz" opacity="0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M-3-3h6l-6 6h6"/><path d="M-3-3h6l-6 6h6"/><path d="M-3-3h6l-6 6h6"/></g>';

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
    timer = setTimeout(() => { timer = undefined; timerAt = Infinity; for (const b of bots) if (b.live()) return kick(); }, Math.max(0, wake - performance.now()));
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
  /** eye colour, INK by default */
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
  if (!el.querySelector(".bd")) el.insertAdjacentHTML("beforeend", DOTS + ZZZ);

  const geo = BODIES[name], foot = geo.foot, [, , sp, er] = geo.face;
  const alpha = Math.asin(Math.min(0.9, sp / FACE_R)), cosA = Math.cos(alpha);
  const bb = el.querySelector(".bb")!, bg = el.querySelector(".bg")!;
  const [eL, eR] = Array.from(bg.firstElementChild!.children);
  const eyesEl = ([[eL!, -1], [eR!, 1]] as const).map(([g, side]) => [g, g.firstElementChild!, g.lastElementChild!, side] as const);
  const bd = el.querySelector(".bd")!, bz = el.querySelector(".bz")!, dots = Array.from(bd.children), zs = Array.from(bz.children);
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
  let nextBlink = 0, blinkAt = -1, blinkTwice = false, nextGlance = 0, nextEvery = 0, nextFidget = 0, taps = 0, tapAt = 0, pokes = 0;
  let spinAt = -1, spinDir = 1, swellAt = -1, paused = false, pendingEnter: string | null = null, life = options.life ?? true, forced = options.still;
  let still = forced ?? reducedPage();

  const runner: Runner = {
    // on screen until the observer says otherwise
    el, on: true, size: size || 0, wakeAt: 0,
    live: () => runner.on && !paused && !still,
    tick,
    pageStill: (s) => { if (forced === undefined) setStillNow(s); },
  };
  (el as Element & { __duskBot?: Runner }).__duskBot = runner;
  const big = () => (runner.size || 40) >= BREATH_PX;

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
      x: 0, y: s.y || 0, r: s.r || 0, sx: s.sx || 1, sy: s.sy || 1, gx, gy,
      ls: lE[0]!, lt: lE[1]!, lb: lE[2]!, lr: lE[3]!, rs: rE[0]!, rt: rE[1]!, rb: rE[2]!, rr: rE[3]!, es: s.es || 1, dm: s.dots ? 1 : 0,
    };
    for (let i = 0; i < P.length; i++) tgt[i] = over[P[i]!] ?? base[P[i]!];
  }
  function settle() {
    act = null; over = {}; pendingEnter = null; blinkAt = -1; spinAt = -1; swellAt = -1;
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
      if (!step) { act = null; over = {}; break; }
      for (const k of Object.keys(step) as (keyof StepValues)[]) {
        const value = step[k];
        if (k === "b") blinkAt = now;
        else if (k === "spin") { spinAt = now; spinDir = v[I.gx]! < -0.05 ? -1 : 1; }
        else if (k === "swell") swellAt = now;
        else if (value === null) delete over[k];
        else (over as Record<string, unknown>)[k] = value;
      }
    }
  }

  // a new look often ends in a blink once the eyes land, about 300 ms on
  function glanceTo(g: [number, number] | null, now: number, hold: number, blinkChance = 0.25) {
    glance = g;
    nextGlance = now + hold;
    if (g && life && blinkAt < 0 && Math.random() < blinkChance) blinkAt = now + between(260, 360);
  }
  const busyLook = () => mood.look === "read" || mood.look === "scan" || mood.look === "away" || mood.look === "work" || mood.look === "type";
  const glances = () => busyLook() || (life && mood.look !== "still");
  const fidgets = () => Boolean(life && mood.fidget && big());
  function schedule(now: number) {
    const s = mood, rate = life ? s.blink ?? 1 : 0;
    if (rate && now >= nextBlink) {
      if (nextBlink && blinkAt < 0) { blinkAt = now; blinkTwice = Math.random() < 0.15; }
      nextBlink = now + between(2500, 5500) / rate;
    }
    if (s.next && now - moodAt > s.next[1]) return setMood(s.next[0], now);
    if (s.every && now >= nextEvery) { if (!act) play(s.every[1], now); nextEvery = now + s.every[0] * between(0.85, 1.25); }
    if (fidgets() && now >= nextFidget) {
      if (!act && !look) play(s.fidget![1][Math.floor(Math.random() * s.fidget![1].length)]!, now);
      nextFidget = now + s.fidget![0] * between(0.8, 1.4);
    }
    if (now >= nextGlance) {
      const mode = glances() ? s.look : "still";
      if (mode === "read") glanceTo([glance && glance[0] < 0 ? 0.35 : -0.35, 0.5], now, between(700, 1200), 0.2);
      else if (mode === "scan") glanceTo([glance && glance[0] < 0 ? between(0.5, 0.85) : -between(0.5, 0.85), between(-0.3, 0.1)], now, between(520, 900), 0.2);
      else if (mode === "work") glanceTo([between(-0.9, 0.9), between(-0.9, 0.5)], now, between(600, 1200), 0.3);
      else if (mode === "type") glanceTo(Math.random() < 0.75 ? [between(-0.7, -0.3), between(0.4, 0.7)] : [between(-0.2, 0.4), between(-0.9, -0.5)], now, between(700, 1400), 0.3);
      else if (mode === "away") glanceTo(glance ? null : [0.55, 0.1], now, glance ? between(1800, 3600) : between(350, 600), 0);
      else if (mode === "still") { glance = null; nextGlance = Infinity; }
      else if (glance && Math.random() < 0.35) glanceTo(null, now, between(1500, 4000));
      else glanceTo([f2(between(-0.9, 0.9)), f2(between(-0.6, 0.6))], now, between(800, 2000));
    }
  }
  function nextEvent(): number {
    const s = mood;
    let at = Infinity;
    if (life && (s.blink ?? 1)) at = Math.min(at, nextBlink);
    if (blinkAt >= 0) at = Math.min(at, blinkAt);
    if (glances()) at = Math.min(at, nextGlance);
    if (s.every) at = Math.min(at, nextEvery);
    if (fidgets()) at = Math.min(at, nextFidget);
    if (s.next) at = Math.min(at, moodAt + s.next[1]);
    return at;
  }
  const continuous = () => Boolean(mood.sway || mood.bob || mood.shiver || ((mood.br || mood.zz) && big()) || v[I.dm]! > 0.3);

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
    const active = Boolean(act) || (blinkAt >= 0 && blinkAt <= now) || spinAt >= 0 || swellAt >= 0 || !resting || continuous();
    if (!active) runner.wakeAt = nextEvent();
    return active;
  }
  // a blink shuts in 80 ms, holds as a dash for 30 ms and opens over 110 ms
  function blinkOf(now: number) {
    if (blinkAt < 0 || now < blinkAt) return 1;
    const t = now - blinkAt;
    if (t >= 220) {
      if (blinkTwice) { blinkTwice = false; blinkAt = now + 60; } else blinkAt = -1;
      return 1;
    }
    return t < 80 ? 1 - 0.82 * smooth(t / 80) : t < 110 ? 0.18 : 0.18 + 0.82 * smooth((t - 110) / 110);
  }
  // two whole turns, slow to start and slow to settle
  function spinOf(now: number) {
    if (spinAt < 0) return 0;
    const p = (now - spinAt) / SPIN_MS;
    if (p >= 1) { spinAt = -1; return 0; }
    return 720 * spinDir * inOut(p);
  }
  function swellOf(now: number) {
    if (swellAt < 0) return 0;
    const t = now - swellAt;
    if (t >= 2500) { swellAt = -1; return 0; }
    return 0.07 * (t < 800 ? smooth(t / 800) : t < 1600 ? 1 : 1 - smooth((t - 1600) / 900));
  }

  function draw(now: number, blink: number) {
    const s = mood, t = now / 1000, lean = s.lean ?? 0.4;
    const grow = swellOf(now);
    let x = v[I.x]!, y = v[I.y]!, r = v[I.r]!, sx = v[I.sx]! + grow, sy = v[I.sy]! + grow, fade = 1;
    if (!still) {
      if (s.br && big()) {
        const w = Math.sin((t * Math.PI * 2) / s.br[1]);
        if (s.br[2]) { sx += w * s.br[0]; sy += w * s.br[0]; } else { sy += w * s.br[0]; sx -= w * s.br[0] * 0.5; }
        if (s.fade) fade = 1 - s.fade * (0.5 - 0.5 * w);
      }
      if (s.sway) r += Math.sin((t * Math.PI * 2) / s.sway[1]) * s.sway[0];
      if (s.bob) y -= Math.abs(Math.sin((t * Math.PI) / s.bob[1])) * s.bob[0];
      if (s.shiver) x += Math.sin(t * 57) * s.shiver;
    }
    const gx = v[I.gx]!, gy = v[I.gy]!, yaw = (gx * YAW + spinOf(now)) * RAD, pitch = gy * PITCH * RAD;
    // the body follows the look: it slides and leans toward it, and a flat body narrows as it turns
    x += Math.sin(gx * YAW * RAD) * (1.5 + 6 * lean);
    r += gx * 10 * lean;
    if (!geo.round) sx *= 0.3 + 0.7 * Math.sqrt(Math.abs(Math.cos(yaw)));
    const dm = clamp(v[I.dm]!, 0, 1), ball = 1 - 0.75 * dm;
    const moved = dm > 0.001 || Math.abs(x) + Math.abs(y) + Math.abs(r) + Math.abs(sx - 1) + Math.abs(sy - 1) > 0.002;
    put(bb, "transform", moved ? `translate(${f2(50 + x)} ${f2(foot + y - (foot - 53) * (1 - ball))}) rotate(${f2(r)}) scale(${f2(sx * ball * 1000) / 1000} ${f2(sy * ball * 1000) / 1000}) translate(-50 ${-foot})` : "translate(0 0)");
    put(bb, "opacity", String(f2(fade * clamp(1 - (dm - 0.35) / 0.4, 0, 1))));
    put(bg, "transform", `translate(0 ${f2(Math.sin(pitch) * FACE_RY)})`);
    // looking up flattens the eyes toward dashes, looking down barely does
    const tall = Math.pow(Math.max(0.05, Math.cos(pitch)), gy < 0 ? 2.5 : 0.6), es = v[I.es]!;
    // the eyes shut before the body melts into dots
    blink = Math.min(blink, 1 - 0.82 * clamp(dm * 2.5, 0, 1));
    for (const [g, path, hl, side] of eyesEl) {
      const o = side < 0 ? 0 : 4, size = v[I.ls + o]!, et = v[I.lt + o]!, eb = v[I.lb + o]!, droop = v[I.lr + o]!;
      // each eye sits on the ball: round the side as the head turns, narrower as it nears the edge, gone behind a round
      // body; a flat one shows its eyes on both faces
      const a = yaw + side * alpha, c = geo.round ? Math.cos(a) : Math.abs(Math.cos(a)), wide = Math.pow(clamp(c / cosA, 0, 1.2), 0.35), slant = -Math.sin(a) * Math.sin(pitch) * 40;
      put(g, "opacity", String(f2(clamp((c - 0.04) / 0.12, 0, 1))));
      put(g, "transform", `translate(${f2(FACE_R * Math.sin(a))} 0) rotate(${f2(droop * side + slant)}) scale(${f2(Math.max(0.01, size * er * es * wide))} ${f2(size * er * es * tall)})`);
      // a blink only closes an open eye; arches and sleeping curves keep their shape
      const open = et > 0 && eb > 0, shut = open ? blink : 1;
      put(path, "d", open ? eyeD(f2(Math.max(0.08, et * shut)), f2(Math.max(0.08, eb * shut))) : eyeD(f2(et), f2(eb)));
      put(hl, "opacity", String(f2(clamp((Math.min(et, eb) * shut - 0.6) / 0.3, 0, 1))));
    }
    // three dots, a bright swell running left to right, 460 ms a dot
    put(bd, "opacity", String(f2(clamp((dm - 0.3) / 0.5, 0, 1))));
    if (dm > 0.3) dots.forEach((d, i) => {
      const p = still ? (i === 1 ? 1 : 0) : Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * ((now / DOT_MS - i) / 3)), 1.5);
      put(d, "transform", `translate(${f2(50 + (i - 1) * 22 * dm)} 53) scale(${f2(1 + 0.27 * p)})`);
      put(d, "opacity", String(f2(0.5 + 0.5 * p)));
    });
    // z's rise and fade every 2.4 s, 800 ms apart
    const zz = Boolean(s.zz) && !still && big();
    put(bz, "opacity", zz ? "1" : "0");
    if (zz) zs.forEach((z, i) => {
      const q = ((now + i * 800) % 2400) / 2400, up = 1 - Math.pow(1 - q, 2);
      put(z, "transform", `translate(${f2(76 + up * 6)} ${f2(26 - up * 14)}) scale(${f2(0.6 + 0.4 * up)})`);
      put(z, "opacity", String(f2(q < 0.25 ? q / 0.25 : 1 - (q - 0.25) / 0.75)));
    });
  }

  function setMood(next: string, now = performance.now()) {
    const key = moodKey(next);
    if (key === moodName) return;
    moodName = key; mood = MOODS[key]!; moodAt = now; glance = null; nextGlance = now + between(300, 900);
    nextEvery = now + (mood.every ? mood.every[0] : 0);
    nextFidget = now + (mood.fidget ? mood.fidget[0] * between(0.6, 1.2) : 0);
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
        move = taps === 1 ? "spin" : taps === 2 ? "hop" : taps === 3 ? "squish" : "dizzy";
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
      for (const p of el.querySelectorAll(".bg path")) p.setAttribute("fill", ink);
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
