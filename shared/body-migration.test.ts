import { describe, expect, it } from "vitest";

import { BODY_NAMES } from "../electron/mascot-geometry.mjs";
import { BODY_MIGRATION, DEFAULT_BOT_BODY, DUSK_BODY_IDS, DUSK_BODY_NAMES, LEGACY_BODY_IDS, duskBody, migrateBodyId } from "./body-migration.ts";

// every body id the app stored or shipped before our own bodies, as its settings schema listed them, and the names the
// website used for bodies it has since renamed
const SAVED_BEFORE = [
  "cursor", "blob", "circle", "squircle", "capsule", "drop", "shield", "hexagon", "diamond", "star", "tablet", "cloud",
  "flower", "sparkle", "wedge", "heart", "fruit", "clover", "square", "teardrop", "pebble", "bean", "egg", "cylinder",
  "hex", "gem", "crystal", "dome", "arch", "leaf", "house",
];
const SITE_NAMES = { clover: "cloud", capsule: "pill", gem: "hex", blob: "circle", teardrop: "drop", square: "squircle", crescent: "moon" };

describe("body migration", () => {
  it("names exactly the bodies the engine draws", () => {
    expect([...DUSK_BODY_IDS].sort()).toEqual([...BODY_NAMES].sort());
    expect(Object.keys(DUSK_BODY_NAMES).sort()).toEqual([...DUSK_BODY_IDS].sort());
  });

  it("draws every id saved before as one of our bodies", () => {
    for (const id of SAVED_BEFORE) expect(DUSK_BODY_IDS, id).toContain(migrateBodyId(id));
  });

  it("keeps the website's renames", () => {
    for (const [from, to] of Object.entries(SITE_NAMES)) expect(migrateBodyId(from), from).toBe(to);
  });

  it("keeps our own ids as they are", () => {
    for (const id of DUSK_BODY_IDS) expect(migrateBodyId(id)).toBe(id);
  });

  it("maps only to our bodies and never shadows one", () => {
    for (const to of Object.values(BODY_MIGRATION)) expect(DUSK_BODY_IDS).toContain(to);
    for (const id of LEGACY_BODY_IDS) expect(DUSK_BODY_IDS as readonly string[]).not.toContain(id);
  });

  it("falls back to the default for unknown, missing and inherited names", () => {
    for (const value of ["hexagram", "", "constructor", "__proto__", "toString", undefined, null, 42, {}]) {
      expect(migrateBodyId(value)).toBeNull();
      expect(duskBody(value)).toBe(DEFAULT_BOT_BODY);
    }
    expect(DUSK_BODY_IDS).toContain(DEFAULT_BOT_BODY);
  });
});
