/** The twenty pixel bodies a bot can wear and the electric palette they are painted from. Pure data: the engine in
 * src/pixel draws them. Each body sits on an N by N grid (16 unless set), floor at N, centre at N / 2. */

/** One colour per bot; the eyes are white. */
export const ELECTRIC = {
  blue: "#286ef9", sky: "#04a2ed", cyan: "#1cb7d8", violet: "#894ef0", pink: "#f12b93", coral: "#f75e51",
  tangerine: "#fb7c01", sun: "#e5a915", lime: "#7ac70f", mint: "#26cb96", emerald: "#10a760", indigo: "#4744e2",
} as const;
export type ElectricColour = keyof typeof ELECTRIC;

/** c circle, e ellipse, s superellipse, r rounded rect, l line, p polygon. */
export type ShapeKind = "c" | "e" | "s" | "r" | "l" | "p";

/** cut erases, mir adds a mirrored copy, piv the point a moving part turns on, q how it moves, amp its swing in degrees,
 * sp its speed, ph its phase, g a group of parts that move together, z draw order. */
export interface PartOptions {
  cut?: 1; mir?: 1; piv?: [number, number]; q?: "sway" | "bob" | "twitch" | "flick"; amp?: number; sp?: number; ph?: number; g?: string; z?: number;
}
export type BodyPart = [ShapeKind, ...(number | PartOptions)[]];

export interface PixelBodyDef {
  N?: number;
  /** hovers off the floor */
  float?: 1;
  eyes: { w: number; h: number; gap: number; y: number; x?: number; r?: 1 };
  parts: BodyPart[];
  /** per-body temperament: spring damping, hop height, blink rate, breath */
  p?: { zeta?: number; hop?: number; blink?: number; bamp?: number };
  quirks?: string[];
  pokes?: string[];
}

const mo = (x: PartOptions): PartOptions => ({ mir: 1, ...x });

export const PIXEL_BODIES = {
  kit: { eyes: { w: 2, h: 3, gap: 4, y: 9 }, parts: [
    ["s", 8, 10.8, 6.8, 5.3, 3],
    ["p", 1.8, 8, 2.6, 1.4, 6.8, 6, mo({ piv: [4.4, 7], q: "twitch", amp: 10 })],
  ] },
  pip: { eyes: { w: 2, h: 4, gap: 4, y: 7 }, parts: [["e", 8, 10, 6.6, 6]] },
  hop: { N: 20, eyes: { w: 2, h: 4, gap: 4, y: 12.4 }, parts: [
    ["e", 10, 14.6, 7.6, 5.4],
    ["l", 7.2, 10, 6.4, 2, 3, mo({ piv: [7.2, 10], q: "sway", amp: 4, sp: 0.7 })],
  ], quirks: ["look", "twitch", "hop"] },
  bruin: { eyes: { w: 2, h: 3, gap: 4, y: 8.6 }, parts: [
    ["c", 8, 10, 6.3], ["c", 3, 4.8, 2.4, mo({ piv: [3.4, 6.4], q: "twitch", amp: 8 })],
  ] },
  boo: { float: 1, eyes: { w: 2, h: 4, gap: 3, y: 5.4 }, parts: [
    ["c", 8, 7.5, 6], ["r", 2, 7.5, 14, 15, 0],
    ["c", 4.7, 15.6, 1.6, { cut: 1 }], ["c", 8, 15.6, 1.6, { cut: 1 }], ["c", 11.3, 15.6, 1.6, { cut: 1 }],
  ] },
  mochi: { eyes: { w: 2, h: 3, gap: 6, y: 10 }, parts: [["s", 8, 12.2, 7.6, 4.3, 2.4]], p: { zeta: 0.32 } },
  loaf: { eyes: { w: 2, h: 3, gap: 5, y: 9 }, parts: [["r", 1.5, 6, 14.5, 16, 4.5]], p: { hop: 0.8 } },
  cheep: { eyes: { w: 2, h: 3, gap: 3, y: 8 }, parts: [
    ["c", 8, 10, 6],
    ["l", 8, 4.6, 6, 1.2, 1.2, { piv: [8, 4.6], g: "tuft", q: "sway", amp: 8 }],
    ["l", 8, 4.6, 10.4, 1.6, 1.2, { piv: [8, 4.6], g: "tuft" }],
  ], p: { blink: 3 } },
  ribbit: { eyes: { w: 2, h: 3, gap: 5, y: 6.6 }, parts: [["s", 8, 12, 7.6, 4, 2.4], ["c", 4.4, 7.6, 3.4, { mir: 1 }]], p: { hop: 1.2 } },
  goo: { eyes: { w: 2, h: 3, gap: 3, y: 8.8 }, parts: [["e", 8, 13, 7.6, 3.2], ["e", 8, 10, 5, 5.6]], p: { zeta: 0.3, bamp: 0.04 } },
  puff: { float: 1, eyes: { w: 2, h: 3, gap: 3, y: 9 }, parts: [
    ["c", 4.8, 11.2, 3.5], ["c", 8.6, 8.6, 4.6], ["c", 12, 11.6, 3.2], ["r", 1.4, 11, 14.9, 15, 2.4],
  ] },
  sprout: { eyes: { w: 2, h: 3, gap: 3, y: 9.4 }, parts: [
    ["e", 8, 11, 6.6, 5],
    ["l", 8, 6.4, 8, 3.8, 1.2, { g: "leaf", piv: [8, 6.2], q: "sway", amp: 7 }],
    ["e", 10.6, 3.2, 2.5, 1.4, { g: "leaf", piv: [8, 6.2] }],
  ] },
  drip: { eyes: { w: 2, h: 3, gap: 2, y: 9.6 }, parts: [["c", 8, 11.2, 4.9], ["p", 8, 1.4, 3.6, 9.4, 12.4, 9.4]] },
  hearty: { eyes: { w: 1, h: 3, gap: 3, y: 6.4 }, parts: [["c", 5.2, 7, 3.8], ["c", 10.8, 7, 3.8], ["p", 1.5, 8.2, 14.5, 8.2, 8, 15.6]] },
  starry: { N: 20, eyes: { w: 1, h: 3, gap: 2, y: 9.2 }, parts: [
    ["p", 10, 1, 12.6, 7.3, 19.4, 7.6, 14.1, 12, 15.9, 19, 10, 15.2, 4.1, 19, 5.9, 12, 0.6, 7.6, 7.4, 7.3], ["c", 10, 11, 4.6],
  ] },
  hoot: { eyes: { w: 2, h: 4, gap: 3, y: 6.4 }, parts: [
    ["s", 8, 9.6, 6.2, 6.4, 2.6],
    ["p", 2.4, 5, 3.2, 1, 6.2, 3.8, mo({ piv: [4.2, 4.5], q: "twitch", amp: 6 })],
  ], p: { blink: 6 } },
  boxo: { eyes: { w: 2, h: 3, gap: 4, y: 7.6 }, parts: [
    ["r", 2, 4.4, 14, 16, 1.2],
    ["l", 8, 4.5, 8, 2.4, 1, { g: "ant", piv: [8, 4.5], q: "bob", amp: 10 }],
    ["c", 8, 2, 2, { g: "ant", piv: [8, 4.5] }],
  ], p: { zeta: 0.5 } },
  egg: { eyes: { w: 2, h: 3, gap: 2, y: 8.4 }, parts: [["e", 8, 9.6, 5.2, 6.4]] },
  wisp: { float: 1, eyes: { w: 1, h: 3, gap: 2, y: 9.4 }, parts: [
    ["c", 8, 11, 4.8], ["p", 8.6, 1, 3.4, 9.4, 12.6, 9.4, { piv: [8, 10], q: "sway", amp: 6, sp: 1.2 }],
  ] },
  tofu: { eyes: { w: 2, h: 3, gap: 4, y: 9 }, parts: [["r", 2, 4, 14, 16, 2.2]], p: { zeta: 0.5, hop: 0.8 } },
} as const satisfies Record<string, PixelBodyDef>;

export type PixelBodyId = keyof typeof PIXEL_BODIES;

/** Picker order: kit, the brand's own, first. */
export const PIXEL_BODY_IDS = Object.keys(PIXEL_BODIES) as [PixelBodyId, ...PixelBodyId[]];

/** Each body's own colour where nothing else paints it. */
export const PIXEL_BODY_COLOUR: Record<PixelBodyId, string> = {
  kit: "#ffffff", pip: ELECTRIC.blue, hop: ELECTRIC.sky, bruin: ELECTRIC.emerald, boo: ELECTRIC.indigo, mochi: ELECTRIC.pink,
  loaf: ELECTRIC.tangerine, cheep: ELECTRIC.sun, ribbit: ELECTRIC.lime, goo: ELECTRIC.mint, puff: ELECTRIC.cyan,
  sprout: ELECTRIC.emerald, drip: ELECTRIC.blue, hearty: ELECTRIC.pink, starry: ELECTRIC.sun, hoot: ELECTRIC.violet,
  boxo: ELECTRIC.cyan, egg: ELECTRIC.mint, wisp: ELECTRIC.coral, tofu: ELECTRIC.violet,
};

/** The brand's own mascot. */
export const BRAND_BODY: PixelBodyId = "kit";
/** kit's colours in the logo: a white cat with tall #212121 eyes. */
export const BRAND_INK = { body: "#ffffff", eyes: "#212121" } as const;
