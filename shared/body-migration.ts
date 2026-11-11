/** The bodies a bot can wear, and the one each body id saved by an older version now draws as. */

export const DUSK_BODY_IDS = ["circle", "squircle", "pill", "hex", "star", "heart", "drop", "moon", "cloud", "pixel"] as const;

export type DuskBodyId = (typeof DUSK_BODY_IDS)[number];

/** What a body is called in a picker and its accessible name. */
export const DUSK_BODY_NAMES: Record<DuskBodyId, string> = {
  circle: "Circle", squircle: "Squircle", pill: "Pill", hex: "Hex", star: "Star",
  heart: "Heart", drop: "Drop", moon: "Moon", cloud: "Cloud", pixel: "Pixel",
};

/** The body a new bot wears, and what an unknown or missing id draws as. */
export const DEFAULT_BOT_BODY: DuskBodyId = "squircle";

/**
 * Every body id an older version saved, in stored bots, synced bots, backups, team files and server data, and the body
 * it draws as now. Never remove an entry: a bot saved with it would lose its look.
 */
export const BODY_MIGRATION = {
  cursor: "squircle",
  blob: "circle",
  capsule: "pill",
  shield: "hex",
  hexagon: "hex",
  diamond: "hex",
  tablet: "squircle",
  flower: "cloud",
  sparkle: "star",
  wedge: "moon",
  fruit: "circle",
  clover: "cloud",
  square: "squircle",
  teardrop: "drop",
  pebble: "circle",
  bean: "pill",
  egg: "drop",
  cylinder: "pill",
  gem: "hex",
  crystal: "hex",
  dome: "circle",
  arch: "pill",
  leaf: "drop",
  house: "pixel",
  crescent: "moon",
} as const satisfies Record<string, DuskBodyId>;

export type LegacyBodyId = keyof typeof BODY_MIGRATION;

export const LEGACY_BODY_IDS = Object.keys(BODY_MIGRATION) as LegacyBodyId[];

export function isDuskBody(value: unknown): value is DuskBodyId {
  return (DUSK_BODY_IDS as readonly unknown[]).includes(value);
}

/** One of our bodies for an id we draw or used to draw, else null. */
export function migrateBodyId(value: unknown): DuskBodyId | null {
  if (isDuskBody(value)) return value;
  return typeof value === "string" && Object.hasOwn(BODY_MIGRATION, value) ? BODY_MIGRATION[value as LegacyBodyId] : null;
}

/** The body a stored id draws as; unknown and missing ids wear the default. */
export function duskBody(value: unknown): DuskBodyId {
  return migrateBodyId(value) ?? DEFAULT_BOT_BODY;
}
