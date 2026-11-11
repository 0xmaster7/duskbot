// Friendly names adapted from Minilytics (https://github.com/surendrapandar/minilytics),
// Copyright (c) 2026 surendrapandar, MIT License. Adapted for Dusk Bot.

import { PIXEL_BODIES, ELECTRIC, type ElectricColour, type PixelBodyId } from "../../../../shared/pixel-bodies";

const COLOURS = [
  "brown", "rose", "olive", "coffee", "amber", "teal", "coral", "indigo",
  "lime", "peach", "plum", "sky", "mint", "ruby", "golden", "silver",
  "lavender", "jade", "blue", "violet", "pink", "cyan", "scarlet", "ivory",
];
const ANIMALS = [
  "fox", "panda", "koala", "tiger", "lion", "frog", "monkey", "unicorn",
  "octopus", "owl", "penguin", "rabbit", "cat", "puppy", "hamster", "bear",
  "otter", "sloth", "hedgehog", "whale", "dolphin", "turtle", "parrot", "flamingo",
  "giraffe", "zebra", "elephant", "butterfly", "bee", "ladybug", "duck", "swan",
  "peacock", "raccoon", "deer", "seal", "crab", "shark", "toucan", "badger",
  "beaver", "alpaca", "bison", "falcon", "gecko", "lynx", "marmot", "puffin",
];
const BODIES = Object.keys(PIXEL_BODIES) as PixelBodyId[];
const COLOURS_ELECTRIC = Object.keys(ELECTRIC) as ElectricColour[];

export function hashOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function friendlyName(id: string): string {
  const hash = hashOf(id);
  return `${COLOURS[hash % COLOURS.length]} ${ANIMALS[(hash >>> 16) % ANIMALS.length]}`;
}

export function avatarOf(id: string): { body: PixelBodyId; colour: ElectricColour } {
  const hash = hashOf(id);
  return { body: BODIES[(hash & 0xffff) % BODIES.length], colour: COLOURS_ELECTRIC[(hash >>> 16) % COLOURS_ELECTRIC.length] };
}
