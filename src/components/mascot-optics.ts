// a tall crystal, a wide heart and a small leaf drawn at one box size read as three sizes, so each body is scaled and
// centred until they all read alike, at rest and at work.
import { createAnimator, createStateDriver, markAppearance, markShapeFor, markTree, type MarkFrame, type MarkNode } from "./mascot-motion-engine";

/** The engine draws a body in a 144-unit square, inset 4.6 into a 55.2 view box at 0.319444. */
const UNITS = 144;
const CENTRE = UNITS / 2;
const VIEW_INSET = 4.6;
const VIEW_SCALE = 0.319444;
/** Every body is fitted to this optical extent, in engine units: a little under the round blob's 103.7. */
export const OPTICAL_EXTENT = 96;
/** The working clip is sampled for 4 s, 20 frames. */
const BUSY_STEP_S = 0.2;
const BUSY_SAMPLES = 20;

export interface MarkOptics {
  scale: number;
  /** Shift that centres the rest pose's bounds, as a fraction of the 144-unit drawing. */
  x: number;
  y: number;
}

interface Outline {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
}

const NONE: MarkOptics = { scale: 1, x: 0, y: 0 };

const engineShape = (body: string) => (body === "fruit" ? "pumpkin" : markShapeFor(body));

function find(node: MarkNode, id: string): MarkNode | undefined {
  if (node.attrs.id === id) return node;
  for (const child of node.children) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return undefined;
}

const pathsIn = (node: MarkNode): string[] => [...(node.tag === "path" ? [String(node.attrs.d)] : []), ...node.children.flatMap(pathsIn)];

function outlineOf(frame: MarkFrame): Outline {
  const tree = markTree(frame, markAppearance("#000", "#fff"), 55.2, "measure", { displaySize: 36, extent: "100%" });
  const defs = find(tree, "measure-body");
  let rings: [number, number][][];
  if (defs) {
    rings = pathsIn(defs).flatMap((d) => d.split(/[Zz]/).map(ringOf));
  } else {
    // the round blob draws straight into the view box, at rest as a circle of arcs
    const d = String(tree.children[0]!.attrs.d);
    const arc = /A([\d.]+)/.exec(d);
    const toUnits = (v: number) => (v - VIEW_INSET) / VIEW_SCALE;
    rings = arc
      ? [Array.from({ length: 96 }, (_, i) => [CENTRE + (Number(arc[1]) / VIEW_SCALE) * Math.cos((i / 48) * Math.PI), CENTRE + (Number(arc[1]) / VIEW_SCALE) * Math.sin((i / 48) * Math.PI)] as [number, number])]
      : d.split(/[Zz]/).map(ringOf).map((ring) => ring.map(([x, y]) => [toUnits(x), toUnits(y)] as [number, number]));
  }
  rings = rings.filter((ring) => ring.length > 2);
  const xs = rings.flat().map((point) => point[0]);
  const ys = rings.flat().map((point) => point[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), area: rings.reduce((sum, ring) => sum + Math.abs(shoelace(ring)), 0) };
}

/** The longest side, softened by the diameter of a circle of the same area, so thin points count less. */
const extentOf = (o: Outline) => Math.sqrt(Math.max(o.maxX - o.minX, o.maxY - o.minY) * 2 * Math.sqrt(o.area / Math.PI));

/** Measures a body from the engine, at rest and through its working clip, and the optics that normalise it. */
export function measureMarkOptics(body: string): MarkOptics & { rest: number; busy: number } {
  const shape = engineShape(body);
  const rest = outlineOf(createAnimator({ body: shape }).frame());
  const animator = createAnimator({ body: shape });
  const driver = createStateDriver(animator, "working", { seed: 1, isCompact: true, isResting: false });
  const busyExtents: number[] = [];
  for (let i = 0; i < BUSY_SAMPLES; i++) {
    driver.advance(BUSY_STEP_S);
    animator.advance(BUSY_STEP_S);
    busyExtents.push(extentOf(outlineOf(animator.frame())));
  }
  busyExtents.sort((a, b) => a - b);
  const busy = busyExtents[Math.floor(busyExtents.length / 2)]!;
  const round = (value: number) => Math.round(value * 1000) / 1000 || 0;
  return {
    rest: extentOf(rest),
    busy,
    scale: round(OPTICAL_EXTENT / ((extentOf(rest) + busy) / 2)),
    x: round((CENTRE - (rest.maxX + rest.minX) / 2) / UNITS),
    y: round((CENTRE - (rest.maxY + rest.minY) / 2) / UNITS),
  };
}

function ringOf(sub: string): [number, number][] {
  const n = sub.replace(/[A-Za-z]/g, " ").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const ring: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) ring.push([n[i]!, n[i + 1]!]);
  return ring;
}

function shoelace(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Measured once from the engine; mascot-optics.test.ts re-measures and fails if the engine's shapes drift. */
export const MARK_OPTICS: Record<string, MarkOptics> = {
  blob: { scale: 0.926, x: 0, y: 0 },
  tablet: { scale: 0.885, x: 0, y: 0 },
  cloud: { scale: 0.895, x: -0.033, y: -0.005 },
  flower: { scale: 0.898, x: 0, y: 0 },
  sparkle: { scale: 0.832, x: 0, y: 0 },
  wedge: { scale: 0.858, x: -0.104, y: -0.074 },
  heart: { scale: 0.913, x: 0.038, y: 0.018 },
  fruit: { scale: 0.908, x: 0.003, y: 0.001 },
  squircle: { scale: 0.884, x: 0, y: 0 },
  clover: { scale: 0.947, x: 0, y: 0 },
  star: { scale: 0.839, x: 0, y: 0 },
  square: { scale: 0.934, x: 0, y: 0 },
  teardrop: { scale: 0.914, x: -0.027, y: -0.016 },
  pebble: { scale: 0.924, x: -0.006, y: -0.003 },
  bean: { scale: 1.027, x: 0.023, y: -0.012 },
  egg: { scale: 1.014, x: -0.013, y: -0.006 },
  capsule: { scale: 1.052, x: 0, y: 0 },
  cylinder: { scale: 0.907, x: 0, y: 0 },
  hex: { scale: 0.908, x: 0, y: 0 },
  gem: { scale: 0.994, x: 0, y: 0 },
  crystal: { scale: 0.866, x: 0, y: 0 },
  shield: { scale: 0.936, x: 0.046, y: 0.029 },
  dome: { scale: 0.964, x: -0.061, y: -0.062 },
  arch: { scale: 0.965, x: -0.029, y: -0.033 },
  leaf: { scale: 1.08, x: 0, y: 0 },
  house: { scale: 0.918, x: -0.045, y: -0.027 },
};

export function markOptics(body: string): MarkOptics {
  return MARK_OPTICS[body] ?? NONE;
}

/** The engine's 144 units span this share of the mark's canvas (46 of its 55.2 view box). */
const DRAWING_SHARE = 46 / 55.2;

/** The canvas transform that centres a mark in its box and draws its body at the shared optical size. */
export function opticalTransform(body: string): string {
  const { scale, x, y } = markOptics(body);
  const pct = (value: number) => Math.round(value * DRAWING_SHARE * 10000) / 100;
  if (scale === 1 && x === 0 && y === 0) return "translate(-50%, -50%)";
  return `translate(-50%, -50%) scale(${scale}) translate(${pct(x)}%, ${pct(y)}%)`;
}
