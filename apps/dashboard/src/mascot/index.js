// the dusk bot engine: moods, reactions and springs for the bots in geometry.js, on one shared animation frame loop.
// no framework and no dependencies; a react app wraps create() in an effect and calls destroy() on cleanup
import { BODIES, FACES, bodyName, eyeD, botSvg, restSvg, INK } from './geometry.js';

export { BODIES, ALIAS, FACES, INK, bodyName, botSvg, restSvg, eyeD, eyeSvg } from './geometry.js';

// every animated number, and its spring: [stiffness, damping]. the body is loose and bouncy, the look critically
// damped (about 350 ms to settle), the eye shapes quick; es scales the eyes, dm melts the body into three dots
const P = ['x', 'y', 'r', 'sx', 'sy', 'gx', 'gy', 'ls', 'lt', 'lb', 'lr', 'rs', 'rt', 'rb', 'rr', 'es', 'dm'];
const SPRING = P.map((_, i) => (i < 5 ? [420, 21] : i < 7 ? [130, 23] : i < 15 ? [1000, 52] : i < 16 ? [600, 40] : [1000, 63]));
const I = Object.fromEntries(P.map((p, i) => [p, i]));

// the head is a ball under the body: a look turns it, so the eyes slide round it and narrow toward the edge
const RAD = Math.PI / 180, YAW = 50, PITCH = 45, FACE_R = 30, FACE_RY = 24, SPIN_MS = 460;

// reactions: steps of [ms from the start, spring targets to hold]. e holds a face, null hands a value back to the
// mood, b blinks, spin turns the head all the way round; the last step ends it
const A = {
  hop: [[0, { sy: 0.84, sx: 1.12, y: 1 }], [90, { sy: 1.14, sx: 0.9, y: -15, e: 'happy' }], [260, { y: 0, sy: 1, sx: 1 }], [360, { sy: 0.88, sx: 1.1 }], [470, { sy: 1, sx: 1 }], [760, { e: null }], [800]],
  bounce: [[0, { sy: 0.9, sx: 1.06 }], [90, { y: -6, sy: 1.06, sx: 0.96 }], [220, { y: 0, sy: 1, sx: 1 }], [320]],
  nod: [[0, { gy: 0.7, sy: 0.95, y: 1.5, e: 'content' }], [170, { gy: -0.1, sy: 1.02, y: 0 }], [330, { gy: 0.7, sy: 0.95, y: 1.5 }], [500, { gy: 0, sy: 1, y: 0 }], [760]],
  nudge: [[0, { gy: 0.6, sy: 0.96, y: 1 }], [180, { gy: null, sy: 1, y: 0 }], [360]],
  greet: [[0, { r: -12, sy: 1.05, e: 'happy', b: 1 }], [150, { r: 10 }], [300, { r: -8 }], [450, { r: 5 }], [600, { r: 0, sy: 1 }], [1100]],
  wiggle: [[0, { r: -9, sy: 1.03 }], [110, { r: 8 }], [220, { r: -6 }], [330, { r: 0, sy: 1 }], [480]],
  startle: [[0, { sy: 0.94, sx: 1.05, y: 2, es: 1.45, e: 'surprised' }], [110, { sy: 1.16, sx: 0.9, y: -7 }], [300, { y: 0, sy: 1.04, sx: 0.97 }], [900, { sy: 1, sx: 1, es: null, e: null }], [960]],
  squish: [[0, { sy: 0.8, sx: 1.16 }], [120, { sy: 1, sx: 1, e: 'happy' }], [620, { e: null }], [660]],
  spin: [[0, { spin: 1, sy: 1.04 }], [300, { sy: 1 }], [SPIN_MS + 60]],
  dizzy: [[0, { e: 'confused', spin: 1 }], [460, { r: -10 }], [640, { r: 9 }], [820, { r: -7 }], [1000, { r: 5 }], [1180, { r: 0 }], [1600, { e: null, b: 1 }], [1640]],
  open: [[0, { sy: 0.94, sx: 1.05, gy: -0.25, b: 1 }], [110, { sy: 1, sx: 1 }], [420, { gy: null }], [460]],
  perk: [[0, { sy: 1.1, sx: 0.93, y: -4, es: 1.3, e: 'surprised' }], [160, { y: 0, sy: 1, sx: 1 }], [520, { es: null, e: null, b: 1 }], [560]],
  stretch: [[0, { sy: 1.14, sx: 0.9, y: -2, e: 'sleeping' }], [520, { sy: 0.94, sx: 1.06, y: 0, e: 'drowsy' }], [720, { sy: 1, sx: 1 }], [900, { e: null, b: 1 }], [940]],
  huff: [[0, { x: -2.5, sy: 1.04 }], [60, { x: 2.5 }], [120, { x: -2 }], [180, { x: 1.5 }], [240, { x: 0, sy: 1 }], [300]],
  shake: [[0, { gx: -0.7 }], [140, { gx: 0.7 }], [280, { gx: -0.6 }], [420, { gx: 0.5 }], [560, { gx: null }], [640]],
  sigh: [[0, { sy: 1.04, gy: -0.3 }], [500, { sy: 0.93, sx: 1.04, gy: 0.3 }], [1200, { sy: 1, sx: 1, gy: null }], [1300]],
  peek: [[0, { gx: 0.4, gy: 0, b: 1 }], [700, { gx: null, gy: null }], [760]],
  laugh: [[0, { r: -5, y: -3, e: 'laughing' }], [110, { r: 4, y: 0 }], [220, { r: -4, y: -3 }], [330, { r: 3, y: 0 }], [440, { r: 0 }], [900, { e: null }], [940]],
  // a slow breath in with a glance each way, about 1.1 s
  swell: [[0, { sx: 1.06, sy: 1.06, gx: -0.3, gy: 0.05 }], [330, { gx: 0.25 }], [650, { sx: 1, sy: 1, gx: null, gy: null }], [1100]],
  // a short dip and squash, about 250 ms
  dip: [[0, { y: 3, sy: 0.95, sx: 1.05 }], [250, { y: 0, sy: 1, sx: 1 }], [420]],
};
A.celebrate = [...A.hop.slice(0, -2), ...A.hop.slice(0, -1).map(([t, v]) => [t + 480, v]), [1300]];
A.twirl = A.spin;
A.surprise = A.startle;
A.tap = null;

// moods. f the face; br breathing [depth, seconds, 1 for an even swell]; fade dims the body with the breath; sway
// [degrees, seconds]; bob [units, seconds]; g where the eyes rest; look how they wander; lean how far the body follows
// the look; every [ms, reaction] repeats; fidget [ms, reactions] picks one now and then on a big bot; enter plays
// once; next [mood, ms] moves on; blink scales the gap between blinks (0 never); follow false ignores the pointer;
// dots melts the body into three pulsing dots; zz lets z's rise
const M = {
  idle: { br: [0.02, 3.2], fidget: [4200, ['swell', 'swell', 'spin']] },
  sleeping: { f: 'sleeping', br: [0.04, 2.4, 1], fade: 0.15, r: -5, y: 1.5, blink: 0, follow: false, look: 'still', zz: 1 },
  waking: { f: 'drowsy', enter: 'stretch', next: ['idle', 1500] },
  drowsy: { f: 'drowsy', br: [0.035, 4], sway: [4, 5], blink: 0.6, look: 'still' },
  listening: { f: 'listening', r: 4, every: [2600, 'nudge'] },
  thinking: { f: 'thinking', dots: 1, follow: false, look: 'still' },
  waiting: { f: 'thinking', g: [0.45, -0.7], sway: [3, 3.4], follow: false, look: 'still' },
  searching: { f: 'searching', y: -1, look: 'scan', lean: 0.6, follow: false },
  working: { f: 'working', look: 'work', lean: 1, sway: [2, 2.6], every: [2600, 'dip'], follow: false },
  writing: { f: 'working', g: [-0.5, 0.55], look: 'type', lean: 0.6, every: [1900, 'dip'], follow: false },
  excited: { f: 'excited', br: [0.03, 0.9], every: [900, 'bounce'], enter: 'spin' },
  surprised: { f: 'surprised', es: 1.15, sy: 1.04, enter: 'startle' },
  suspicious: { f: 'suspicious', r: -3, g: [-0.5, 0], look: 'away' },
  angry: { f: 'angry', sx: 1.05, sy: 0.96, every: [1800, 'huff'], enter: 'huff' },
  happy: { f: 'happy', sway: [3, 1.8], fidget: [3600, ['swell', 'spin']] },
  curious: { f: 'curious', r: 9, y: -1 },
  confused: { f: 'confused', sway: [7, 2.6], g: [0.2, -0.3] },
  bored: { f: 'bored', g: [-0.6, 0.3], br: [0.03, 5], every: [5200, 'sigh'], look: 'still' },
  proud: { f: 'proud', sy: 1.05, sx: 0.97, g: [0, -0.45], look: 'still' },
  shy: { f: 'shy', g: [-0.55, 0.5], r: -6, sx: 0.96, sy: 0.97, every: [3200, 'peek'], follow: false, look: 'still' },
  sad: { f: 'sad', y: 2, sy: 0.95, sx: 1.03, g: [0, 0.4], br: [0.025, 4.4], look: 'still' },
  laughing: { f: 'laughing', bob: [2.2, 0.24], sway: [3, 0.48] },
  scared: { f: 'scared', sy: 0.92, sx: 0.97, y: 2, shiver: 0.7, follow: false, look: 'still' },
  playful: { f: 'playful', sway: [6, 1.4], every: [2200, 'bounce'] },
  celebrate: { f: 'happy', every: [1500, 'hop'], enter: 'hop' },
  finished: { f: 'happy', sway: [3, 1.8], enter: 'hop' },
};
const SAME = { asleep: 'sleeping', sleep: 'sleeping', done: 'finished', listen: 'listening', think: 'thinking', search: 'searching', busy: 'working', startled: 'surprised', excite: 'excited', laugh: 'laughing', joy: 'happy', typing: 'writing', wait: 'waiting' };
/** every mood setState() knows, and the reactions react() plays */
export const STATES = [...Object.keys(M), ...Object.keys(SAME)];
export const REACTIONS = Object.keys(A);

const between = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const f2 = (v) => Math.round(v * 100) / 100;
const smooth = (p) => p * p * (3 - 2 * p);
const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let stillPage = !!motionQuery?.matches;

// the extra parts a moving bot needs: three dots to melt into and three z's to sleep under
const DOTS = '<g class="bd" opacity="0" fill="currentColor"><circle r="7"/><circle r="7"/><circle r="7"/></g>';
const ZZZ = '<g class="bz" opacity="0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M-3-3h6l-6 6h6"/><path d="M-3-3h6l-6 6h6"/><path d="M-3-3h6l-6 6h6"/></g>';

// one loop for every bot: it runs only while some bot is on screen and the tab is visible
const bots = new Set();
let raf = 0, last = 0;
function kick() {
  if (raf || (typeof document !== 'undefined' && document.hidden)) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function frame(now) {
  raf = 0;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let busy = false;
  for (const b of bots) if (b.moving()) { b.tick(now, dt); busy = true; }
  if (busy) raf = requestAnimationFrame(frame);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const b = e.target.__duskBot;
    if (!b) continue;
    b.on = e.isIntersecting;
    if (b.on && !b.size) b.size = e.boundingClientRect.width;
    if (b.on) kick();
  }
}, { rootMargin: '40px' }) : null;
motionQuery?.addEventListener?.('change', (e) => {
  stillPage = e.matches;
  for (const b of bots) b.still(stillPage);
});

/**
 * where to look for a pointer at (x, y), seen from a bot drawn in rect: a direction in -1..1, or null when the pointer
 * is further than reach px from the bot's middle
 * @param {{ left: number, top: number, width: number, height: number }} rect
 */
export function pointerGaze(rect, x, y, reach = 220) {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
  if (d > reach) return null;
  const pull = Math.min(1, d / Math.max(rect.width * 0.9, 36));
  return { x: f2((dx / d) * pull), y: f2((dy / d) * pull * 0.8) };
}

/**
 * brings a bot to life. target is an svg or g that already holds a bot (from botSvg or restSvg), or an empty svg or
 * element to draw one into
 * @param {Element} target
 * @param {{ body?: string, colour?: string, eyes?: string, state?: string, size?: number, observe?: boolean, reducedMotion?: boolean }} [opts]
 */
export function create(target, { body, colour, eyes, state = 'idle', size, observe = true, reducedMotion } = {}) {
  const name = bodyName(body || target.getAttribute('data-body') || 'circle');
  let el = target;
  if (!target.querySelector('.bb')) {
    if (target instanceof SVGElement) target.innerHTML = botSvg(name, 'idle', eyes || INK);
    else { target.innerHTML = restSvg(name, { eyes }); el = target.firstElementChild; }
    if (el.tagName === 'svg' && !el.getAttribute('viewBox')) el.setAttribute('viewBox', '0 0 100 100');
  } else if (eyes) for (const p of el.querySelectorAll('.bg path')) p.setAttribute('fill', eyes);
  if (colour) el.style.color = colour;
  if (!el.querySelector('.bd')) el.insertAdjacentHTML('beforeend', DOTS + ZZZ);

  const geo = BODIES[name], foot = geo.foot, [, , sp, er] = geo.face;
  const alpha = Math.asin(Math.min(0.9, sp / FACE_R)), cosA = Math.cos(alpha);
  const bb = el.querySelector('.bb'), bg = el.querySelector('.bg'), [eL, eR] = bg.firstElementChild.children;
  const dots = [...el.querySelector('.bd').children], zs = [...el.querySelector('.bz').children], bd = dots[0].parentNode, bz = zs[0].parentNode;
  const eyesEl = [[eL, eL.firstElementChild, eL.lastElementChild, -1], [eR, eR.firstElementChild, eR.lastElementChild, 1]];
  const v = new Float64Array(P.length), vel = new Float64Array(P.length), tgt = new Float64Array(P.length);
  // writes an attribute only when it changed
  const put = (node, attr, val) => {
    const seenVals = (node.__w ||= {});
    if (seenVals[attr] === val) return;
    seenVals[attr] = val;
    node.setAttribute(attr, val);
  };

  let mood = M.idle, moodName = 'idle', moodAt = 0, act = null, over = {}, look = null, glance = null;
  let nextBlink = 0, blinkAt = -1, blinkTwice = false, nextGlance = 0, nextEvery = 0, nextFidget = 0, taps = 0, tapAt = 0, paused = false;
  let spinAt = -1, spinDir = 1, still = reducedMotion ?? stillPage, pendingEnter = null;

  const bot = {
    el, body: name, on: !observe || !seen, size: size || 0,
    moving: () => bot.on && !paused && !still && bots.has(bot),
    tick,
    still: (s) => { if (reducedMotion === undefined) { still = s; settle(); if (!s) kick(); } },
  };
  el.__duskBot = bot;
  const big = () => (bot.size || 40) >= 40;

  function faceOf() { return FACES[over.e || mood.f || 'idle'] || FACES.idle; }
  function targets() {
    const s = mood, fc = faceOf(), lE = fc.l, rE = fc.r || fc.l;
    // where the eyes go: a reaction, then the pointer, then a glance, then where the mood rests them
    let gx = s.g ? s.g[0] : 0, gy = s.g ? s.g[1] : 0;
    if (glance) [gx, gy] = glance;
    if (look && s.follow !== false) ({ x: gx, y: gy } = look);
    if (over.gx != null) gx = over.gx;
    if (over.gy != null) gy = over.gy;
    const base = { x: 0, y: s.y || 0, r: s.r || 0, sx: s.sx || 1, sy: s.sy || 1, gx, gy, ls: lE[0], lt: lE[1], lb: lE[2], lr: lE[3], rs: rE[0], rt: rE[1], rb: rE[2], rr: rE[3], es: s.es || 1, dm: s.dots ? 1 : 0 };
    for (let i = 0; i < P.length; i++) tgt[i] = over[P[i]] ?? base[P[i]];
  }
  function settle() {
    act = null; over = {}; spinAt = -1;
    targets();
    v.set(tgt); vel.fill(0);
    draw(0, 1);
  }

  function play(kind, now = performance.now()) {
    const steps = A[kind];
    if (!steps) return;
    act = { steps, i: 0, t0: now };
    over = {};
  }
  function runAct(now) {
    if (!act) return;
    const t = now - act.t0;
    while (act && act.i < act.steps.length && act.steps[act.i][0] <= t) {
      const [, step] = act.steps[act.i++];
      if (!step) { act = null; over = {}; break; }
      for (const k in step) {
        if (k === 'b') blinkAt = now;
        else if (k === 'spin') { spinAt = now; spinDir = v[I.gx] < -0.05 ? -1 : 1; }
        else if (step[k] === null) delete over[k];
        else over[k] = step[k];
      }
    }
  }

  // a new look often ends in a blink once the eyes land, about 300 ms on
  function glanceTo(g, now, hold, blinkChance = 0.35) {
    glance = g;
    nextGlance = now + hold;
    if (g && blinkAt < 0 && Math.random() < blinkChance) blinkAt = now + between(260, 360);
  }
  function schedule(now) {
    const s = mood, rate = s.blink ?? 1;
    if (rate && now >= nextBlink) {
      if (blinkAt < 0) { blinkAt = now; blinkTwice = Math.random() < 0.15; }
      nextBlink = now + between(1600, 3600) / rate;
    }
    if (s.next && now - moodAt > s.next[1]) return setMood(s.next[0], now);
    if (s.every && now >= nextEvery) { if (!act) play(s.every[1], now); nextEvery = now + s.every[0] * between(0.85, 1.25); }
    if (s.fidget && big() && now >= nextFidget) {
      if (!act && !look) play(s.fidget[1][Math.floor(Math.random() * s.fidget[1].length)], now);
      nextFidget = now + s.fidget[0] * between(0.8, 1.4);
    }
    if (now >= nextGlance) {
      const mode = s.look;
      if (mode === 'read') glanceTo([glance && glance[0] < 0 ? 0.35 : -0.35, 0.5], now, between(700, 1200), 0.2);
      else if (mode === 'scan') glanceTo([glance && glance[0] < 0 ? between(0.5, 0.85) : -between(0.5, 0.85), between(-0.3, 0.1)], now, between(520, 900), 0.2);
      else if (mode === 'work') glanceTo([between(-0.9, 0.9), between(-0.9, 0.5)], now, between(400, 700), 0.3);
      else if (mode === 'type') glanceTo(Math.random() < 0.75 ? [between(-0.7, -0.3), between(0.4, 0.7)] : [between(-0.2, 0.4), between(-0.9, -0.5)], now, between(500, 1100), 0.3);
      else if (mode === 'away') glanceTo(glance ? null : [0.55, 0.1], now, glance ? between(1800, 3600) : between(350, 600), 0);
      else if (mode === 'still') { glance = null; nextGlance = now + 1e9; }
      else if (glance && Math.random() < 0.35) glanceTo(null, now, between(1200, 3500));
      else glanceTo([f2(between(-0.9, 0.9)), f2(between(-0.6, 0.6))], now, between(500, 1300));
    }
  }

  function tick(now, dt) {
    if (pendingEnter) { play(pendingEnter, now); pendingEnter = null; }
    schedule(now);
    runAct(now);
    targets();
    // springs, in steps small enough to stay steady at any frame rate
    const n = Math.ceil(dt / (1 / 120)), h = dt / n;
    for (let s = 0; s < n; s++) for (let i = 0; i < P.length; i++) {
      const [k, c] = SPRING[i];
      vel[i] += (k * (tgt[i] - v[i]) - c * vel[i]) * h;
      v[i] += vel[i] * h;
    }
    draw(now, blinkOf(now));
  }
  // a blink shuts in 40 ms, holds as a dash for 30 ms and opens over 70 ms
  function blinkOf(now) {
    if (blinkAt < 0 || now < blinkAt) return 1;
    const t = now - blinkAt;
    if (t >= 140) {
      if (blinkTwice) { blinkTwice = false; blinkAt = now + 50; } else blinkAt = -1;
      return 1;
    }
    return t < 40 ? 1 - 0.82 * smooth(t / 40) : t < 70 ? 0.18 : 0.18 + 0.82 * smooth((t - 70) / 70);
  }
  function spinOf(now) {
    if (spinAt < 0) return 0;
    const p = (now - spinAt) / SPIN_MS;
    if (p >= 1) { spinAt = -1; return 0; }
    return 360 * spinDir * inOut(p);
  }

  function draw(now, blink) {
    const s = mood, t = now / 1000, lean = s.lean ?? 0.4;
    let x = v[I.x], y = v[I.y], r = v[I.r], sx = v[I.sx], sy = v[I.sy], fade = 1;
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
    const gx = v[I.gx], gy = v[I.gy], yaw = (gx * YAW + spinOf(now)) * RAD, pitch = gy * PITCH * RAD;
    // the body follows the look: it slides and leans toward it, and a flat body narrows as it turns
    x += Math.sin(gx * YAW * RAD) * (1.5 + 4 * lean);
    r += gx * 10 * lean;
    if (!geo.round) sx *= 0.3 + 0.7 * Math.sqrt(Math.abs(Math.cos(yaw)));
    const dm = clamp(v[I.dm], 0, 1), ball = 1 - 0.75 * dm;
    const moved = dm > 0.001 || Math.abs(x) + Math.abs(y) + Math.abs(r) + Math.abs(sx - 1) + Math.abs(sy - 1) > 0.002;
    put(bb, 'transform', moved ? `translate(${f2(50 + x)} ${f2(foot + y - (foot - 53) * (1 - ball))}) rotate(${f2(r)}) scale(${f2(sx * ball * 1000) / 1000} ${f2(sy * ball * 1000) / 1000}) translate(-50 ${-foot})` : 'translate(0 0)');
    put(bb, 'opacity', String(f2(fade * clamp(1 - (dm - 0.35) / 0.4, 0, 1))));
    put(bg, 'transform', `translate(0 ${f2(Math.sin(pitch) * FACE_RY)})`);
    const tall = Math.pow(Math.max(0.05, Math.cos(pitch)), 1.3), es = v[I.es];
    for (const [g, path, hl, side] of eyesEl) {
      const o = side < 0 ? 0 : 4, size = v[I.ls + o], et = v[I.lt + o], eb = v[I.lb + o], droop = v[I.lr + o];
      // each eye sits on the ball: round the side as the head turns, narrower as it nears the edge, gone behind it
      const a = yaw + side * alpha, c = Math.cos(a), wide = Math.pow(clamp(c / cosA, 0, 1.2), 0.35), slant = -Math.sin(a) * Math.sin(pitch) * 40;
      put(g, 'opacity', String(f2(clamp((c - 0.04) / 0.12, 0, 1))));
      put(g, 'transform', `translate(${f2(FACE_R * Math.sin(a))} 0) rotate(${f2(droop * side + slant)}) scale(${f2(Math.max(0.01, size * er * es * wide))} ${f2(size * er * es * tall)})`);
      // a blink only closes an open eye; arches and sleeping curves keep their shape
      const open = et > 0 && eb > 0, shut = open ? blink : 1;
      put(path, 'd', open ? eyeD(f2(Math.max(0.08, et * shut)), f2(Math.max(0.08, eb * shut))) : eyeD(f2(et), f2(eb)));
      put(hl, 'opacity', String(f2(clamp((Math.min(et, eb) * shut - 0.6) / 0.3, 0, 1))));
    }
    // three dots, a bright swell running left to right, 110 ms a dot
    put(bd, 'opacity', String(f2(clamp((dm - 0.3) / 0.5, 0, 1))));
    if (dm > 0.3) dots.forEach((d, i) => {
      const p = still ? (i === 1 ? 1 : 0) : Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (t / 0.33 - i / 3)), 2);
      put(d, 'transform', `translate(${f2(50 + (i - 1) * 22 * dm)} 53) scale(${f2(1 + 0.25 * p)})`);
      put(d, 'opacity', String(f2(0.45 + 0.55 * p)));
    });
    // z's rise and fade every 2.4 s, 800 ms apart
    const zz = s.zz && !still && big();
    put(bz, 'opacity', zz ? '1' : '0');
    if (zz) zs.forEach((z, i) => {
      const q = ((now + i * 800) % 2400) / 2400, up = 1 - Math.pow(1 - q, 2);
      put(z, 'transform', `translate(${f2(76 + up * 6)} ${f2(26 - up * 14)}) scale(${f2(0.6 + 0.4 * up)})`);
      put(z, 'opacity', String(f2(q < 0.25 ? q / 0.25 : 1 - (q - 0.25) / 0.75)));
    });
  }

  function setMood(name, now = performance.now()) {
    const key = M[name] ? name : SAME[name] || 'idle';
    if (key === moodName) return;
    moodName = key; mood = M[key]; moodAt = now; glance = null; nextGlance = now + between(300, 900);
    nextEvery = now + (mood.every ? mood.every[0] : 0);
    nextFidget = now + (mood.fidget ? mood.fidget[0] * between(0.6, 1.2) : 0);
    if (still) return settle();
    if (mood.enter) pendingEnter = mood.enter;
    kick();
  }

  const handle = {
    el, body: name,
    get state() { return moodName; },
    /** @param {string} name one of STATES */
    setState(name) { setMood(name); },
    /** @param {string} kind one of REACTIONS; tap escalates: a spin, then a hop, a squish, and dizzy */
    react(kind) {
      if (still || paused) return;
      const now = performance.now();
      if (kind === 'tap') {
        taps = now - tapAt < 1300 ? taps + 1 : 1;
        tapAt = now;
        kind = taps === 1 ? 'spin' : taps === 2 ? 'hop' : taps === 3 ? 'squish' : 'dizzy';
      }
      if (kind === 'blink') blinkAt = now;
      else play(kind, now);
      kick();
    },
    /** eyes and lean toward a direction in -1..1 (x right, y down), or null to look about on its own */
    lookAt(x, y) {
      look = x == null ? null : { x: clamp(x, -1, 1), y: clamp(y ?? 0, -1, 1) };
      if (still) return;
      kick();
    },
    blink() { if (!still) { blinkAt = performance.now(); kick(); } },
    /** holds the current pose and stops drawing until resume() */
    pause() { paused = true; },
    resume() { paused = false; kick(); },
    destroy() { bots.delete(bot); seen?.unobserve(el); delete el.__duskBot; },
  };

  bots.add(bot);
  if (observe && seen) seen.observe(el); else kick();
  moodName = '';
  setMood(state);
  if (still) settle();
  return handle;
}
