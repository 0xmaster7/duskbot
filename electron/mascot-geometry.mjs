// the dusk bots: ten flat bodies and one face, drawn from plain shapes in a 100 by 100 box
const n = (v) => String(Math.round(v * 100) / 100);
export const INK = "#fff";

const circle = (cx, cy, r) => `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;

// a polygon with each corner cut r back along both edges and joined by a curve through the corner
function soft(pts, r) {
  const rs = Array.isArray(r) ? r : pts.map(() => r);
  let d = "";
  pts.forEach(([x, y], i) => {
    const [px, py] = pts[(i + pts.length - 1) % pts.length], [nx, ny] = pts[(i + 1) % pts.length];
    const lp = Math.hypot(px - x, py - y), ln = Math.hypot(nx - x, ny - y), c = Math.min(rs[i], lp / 2, ln / 2);
    const a = [x + ((px - x) / lp) * c, y + ((py - y) / lp) * c], b = [x + ((nx - x) / ln) * c, y + ((ny - y) / ln) * c];
    d += `${i ? "L" : "M"}${n(a[0])} ${n(a[1])}Q${n(x)} ${n(y)} ${n(b[0])} ${n(b[1])}`;
  });
  return d + "Z";
}
const ring = (cx, cy, count, radius, start = -90) => Array.from({ length: count }, (_, i) => {
  const a = ((start + (360 / count) * i) * Math.PI) / 180, r = typeof radius === "function" ? radius(i) : radius;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});

// a crescent: the big circle less a smaller one set up and to the right
function moon(cx, cy, R, ix, iy, r) {
  const dx = ix - cx, dy = iy - cy, d = Math.hypot(dx, dy), a = (R * R - r * r + d * d) / (2 * d), h = Math.sqrt(R * R - a * a);
  const mx = cx + (dx * a) / d, my = cy + (dy * a) / d, p1 = [mx + (dy * h) / d, my - (dx * h) / d], p2 = [mx - (dy * h) / d, my + (dx * h) / d];
  return `M${n(p1[0])} ${n(p1[1])}A${R} ${R} 0 1 0 ${n(p2[0])} ${n(p2[1])}A${r} ${r} 0 0 1 ${n(p1[0])} ${n(p1[1])}Z`;
}

// pixel steps of 7 round a 70 square
const px = [[29, 18], [71, 18], [71, 25], [78, 25], [78, 32], [85, 32], [85, 74], [78, 74], [78, 81], [71, 81], [71, 88], [29, 88], [29, 81], [22, 81], [22, 74], [15, 74], [15, 32], [22, 32], [22, 25], [29, 25]];

export const BODIES = {
  circle: { d: circle(50, 53, 35), foot: 88, face: [50, 54, 12, 6.4] },
  squircle: { d: soft([[15, 18], [85, 18], [85, 88], [15, 88]], 27), foot: 88, face: [50, 54, 12.5, 6.4] },
  pill: { d: "M37 38H63A25 25 0 0 1 63 88H37A25 25 0 0 1 37 38Z", foot: 88, face: [50, 61, 12.5, 6.2] },
  hex: { d: soft(ring(50, 54.5, 6, 38, 0), 9), foot: 87, face: [50, 55, 12, 6.2] },
  star: { d: soft(ring(50, 57, 10, (i) => (i % 2 ? 24 : 42)), [8, 3, 8, 3, 8, 3, 8, 3, 8, 3]), foot: 88, face: [50, 59, 9, 5.4] },
  heart: { d: "M50 87C46 84 12 64 12 38C12 25 22 16 33 16C41 16 46.5 20.5 50 27C53.5 20.5 59 16 67 16C78 16 88 25 88 38C88 64 54 84 50 87Z", foot: 87, face: [50, 47, 12.5, 6.2] },
  drop: { d: "M50 9C57 21 81 39 81 58A31 31 0 0 1 19 58C19 39 43 21 50 9Z", foot: 89, face: [50, 62, 11, 6] },
  moon: { d: moon(50, 52, 37, 77, 33, 26), foot: 89, face: [37, 63, 10, 6, -24] },
  cloud: { d: `${circle(31, 66, 19)}${circle(52, 46, 24)}${circle(70, 66, 19)}M31 56V85H70V56Z`, foot: 85, face: [50, 64, 11.5, 6] },
  pixel: { d: soft(px, 1.4), foot: 88, face: [50, 54, 12.5, 6.4] },
};
export const BODY_NAMES = /** @type {(keyof typeof BODIES)[]} */ (Object.keys(BODIES));
export const bodyName = (name) => (Object.hasOwn(BODIES, name) ? name : "circle");

// one eye in unit size: an oval whose top rises t and bottom falls b. a negative b lifts the bottom into a happy arch,
// a negative t drops the top into a sleeping curve
const K = 0.5523;
export function eyeD(t, b) {
  if (t + b < 0.16) b = 0.16 - t;
  return `M-1 0C-1 ${n(-t * K)} ${n(-K)} ${n(-t)} 0 ${n(-t)}C${n(K)} ${n(-t)} 1 ${n(-t * K)} 1 0C1 ${n(b * K)} ${n(K)} ${n(b)} 0 ${n(b)}C${n(-K)} ${n(b)} -1 ${n(b * K)} -1 0Z`;
}
// the mouth: w half wide, s how much it smiles (less than 0 frowns), o how open. shut, it is a stroked curve
export function mouthD(w, s, o) {
  if (w < 0.4) return "";
  return `M${n(-w)} 0Q0 ${n(2 * s)} ${n(w)} 0Q0 ${n(2 * s + 2 * Math.max(0, o))} ${n(-w)} 0Z`;
}

// faces: each eye [size, top, bottom, outer droop in degrees; less than 0 droops the inner end], mouth [half width,
// smile, open], blush. r is the right eye when it differs
const ARCH = [1.05, 1.15, -0.52, 0], SHUT = [1.05, -0.4, 0.75, 0], DOT = [1, 1.08, 1.08, 0];
export const FACES = {
  idle: { l: DOT, m: [0, 0, 0], k: 0 },
  happy: { l: ARCH, m: [5.5, 2.4, 1.2], k: 1 },
  content: { l: [1, 0.7, 0.85, 0], m: [4, 1.6, 0], k: 0.4 },
  proud: { l: [1, 1.1, -0.3, 0], m: [4.5, 1.8, 0], k: 0.3 },
  laughing: { l: ARCH, m: [6, 2, 4], k: 0.8 },
  playful: { l: ARCH, r: [1.05, 1.1, 1.1, 0], m: [4.5, 2, 0.8], k: 0.5 },
  excited: { l: [1.2, 1.25, 1.25, 0], m: [5, 2.4, 2.6], k: 0.7 },
  shy: { l: [0.95, 0.9, 0.9, 0], m: [2.4, 1, 0], k: 1 },
  sad: { l: [0.95, 0.5, 1.05, 16], m: [4.2, -1.6, 0], k: 0 },
  scared: { l: [1.25, 1.3, 1.3, 0], m: [3.4, -1.2, 1.6], k: 0 },
  angry: { l: [1, 0.5, 1, -20], m: [4, -1.8, 0], k: 0 },
  sleeping: { l: SHUT, m: [1.6, -0.6, 1.4], k: 0 },
  drowsy: { l: [1, 0.28, 0.9, 0], m: [0, 0, 0], k: 0 },
  bored: { l: [1, 0.35, 0.8, 0], m: [3, 0, 0], k: 0 },
  surprised: { l: [1.28, 1.25, 1.25, 0], m: [2.4, -2.2, 4.6], k: 0 },
  working: { l: [1, 0.55, 0.95, 0], m: [2.6, 0, 0], k: 0 },
  thinking: { l: [1, 1.05, 0.7, 0], m: [2.4, -0.5, 0], k: 0 },
  searching: { l: [1.1, 1.15, 1.15, 0], m: [0, 0, 0], k: 0 },
  listening: { l: [1.05, 1.12, 1.12, 0], m: [0, 0, 0], k: 0.25 },
  curious: { l: [0.9, 0.95, 1, 0], r: [1.22, 1.2, 1.2, 0], m: [1.8, -1.4, 2], k: 0 },
  confused: { l: [0.82, 0.9, 0.9, 0], r: [1.15, 1.12, 1.12, 0], m: [2.6, -0.9, 0], k: 0 },
  suspicious: { l: [1, 0.38, 0.5, 0], r: [1, 0.62, 0.62, 0], m: [3, -0.4, 0], k: 0 },
};

const eyeG = (x, r, [s, t, b, droop], side, ink) => `<g transform="translate(${n(x)} 0) rotate(${n(droop * side)}) scale(${n(s * r)})"><path fill="${ink}" d="${eyeD(t, b)}"/><circle fill="#fff" cx=".32" cy="-.38" r=".32" opacity="${Math.min(t, b) < 0.75 ? 0 : 1}"/></g>`;

/**
 * the inside of one bot's svg (viewBox 0 0 100 100), in a face from FACES. the parts, in the order the engine finds
 * them: .bb the body, .bg the face, then two blushes, two eyes and the mouth
 */
export function botSvg(name, face = "idle", ink = INK) {
  const body = BODIES[bodyName(name)], [fx, fy, sp, r, turn = 0] = body.face, e = FACES[face] || FACES.idle, [w, s, o] = e.m;
  const blush = [-1, 1].map((side) => `<ellipse fill="#ff4f86" cx="${n(side * (sp + r * 0.75))}" cy="${n(r * 1.45)}" rx="${n(r * 0.8)}" ry="${n(r * 0.45)}" opacity="${n(e.k * 0.55)}"/>`).join("");
  return `<g class="bb"><path fill="currentColor" d="${body.d}"/><g class="bg"><g transform="translate(${fx} ${fy})${turn ? ` rotate(${turn})` : ""}">${blush}${eyeG(-sp, r, e.l, -1, ink)}${eyeG(sp, r, e.r || e.l, 1, ink)}<path fill="${ink}" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 ${n(r * 1.9 + 2)})" d="${mouthD(w, s, o)}"/></g></g></g>`;
}

/** a whole bot as an svg string, for markup written before any script runs */
export function restSvg(name, { colour, eyes = INK, face = "idle", className = "bot", attrs = "" } = {}) {
  return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true" data-body="${bodyName(name)}"${colour ? ` color="${colour}"` : ""}${attrs ? " " + attrs : ""}>${botSvg(name, face, eyes)}</svg>`;
}
