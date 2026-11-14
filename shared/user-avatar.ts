/**
 * A person's avatar, as the account keeps it (`avatar` on the account service): absent for the default drawn from the account
 * id, `photo` for the photo of their google or x sign-in, or `g:<seed>` for a drawn one they picked. The drawing is
 * deterministic: the same seed draws the same picture on every device.
 */
export type UserAvatarChoice = "photo" | `g:${string}`;

const CHOICE = /^(?:photo|g:[a-z0-9]{1,16})$/;

export function parseUserAvatarChoice(value: unknown): UserAvatarChoice | null {
  return typeof value === "string" && CHOICE.test(value) ? value as UserAvatarChoice : null;
}

/** What to draw for an account: its photo, or a drawing from a seed. */
export type UserAvatarFace = { kind: "photo"; url: string } | { kind: "drawn"; seed: string };

/** A drawing they picked, the photo of their sign-in when they chose it and still have one, else the drawing seeded from
 * their account id. */
export function userAvatarFace(account: { id: string; avatarUrl?: string; avatar?: string }): UserAvatarFace {
  const choice = parseUserAvatarChoice(account.avatar);
  if (choice?.startsWith("g:")) return { kind: "drawn", seed: choice.slice(2) };
  if (choice === "photo" && account.avatarUrl) return { kind: "photo", url: account.avatarUrl };
  return { kind: "drawn", seed: account.id };
}

/** A fresh seed for Shuffle and the suggestions: 8 base-36 characters. */
export function newAvatarSeed(random: () => number = Math.random): string {
  let seed = "";
  for (let i = 0; i < 8; i++) seed += Math.floor(random() * 36).toString(36);
  return seed;
}

function hash(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** A small seeded generator (mulberry32). */
export function seededRandom(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AvatarPixels {
  /** cells per side */
  size: number;
  /** one colour per cell, row by row */
  cells: string[];
  /** the background, also the margin round the art when a size is not a whole multiple of the grid */
  tile: string;
}

// placeholder drawing until the creature set is picked: a mirrored 8 by 8 mark in a brand pastel, outlined in a deeper
// shade of itself, on a pale tile of another hue
const PLACEHOLDER = [
  { fill: "#b99af2", line: "#4e3475", tile: "#f4efe6" },
  { fill: "#f6b183", line: "#7b4824", tile: "#eaf4fb" },
  { fill: "#a6dd6c", line: "#426a03", tile: "#f7eef3" },
  { fill: "#7cc6f2", line: "#175778", tile: "#f6f0e2" },
  { fill: "#f4a0c4", line: "#783b57", tile: "#eef6e6" },
] as const;

export function drawUserAvatar(seed: string): AvatarPixels {
  const random = seededRandom(`user:${seed}`);
  const colours = PLACEHOLDER[Math.floor(random() * PLACEHOLDER.length)]!;
  const size = 8;
  const on = Array.from({ length: size }, (_, y) => Array.from({ length: size / 2 }, (_, x) => x > 0 && y > 0 && y < size - 1 && random() < 0.55));
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && on[y]![x < size / 2 ? x : size - 1 - x]!;
  const cells: string[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const edge = !filled(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => filled(x + dx!, y + dy!));
    cells.push(filled(x, y) ? colours.fill : edge ? colours.line : colours.tile);
  }
  return { size, cells, tile: colours.tile };
}
