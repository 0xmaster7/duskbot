import { describe, expect, it } from "vitest";
import { ELECTRIC, PIXEL_BODIES } from "../../../../shared/pixel-bodies";
import { avatarOf, friendlyName, hashOf } from "./names.ts";

function randomIds(): string[] {
  let state = 123456789;
  return Array.from({ length: 1000 }, () => {
    const words = Array.from({ length: 4 }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state.toString(16).padStart(8, "0");
    });
    return words.join("-");
  });
}

describe("visitor identities", () => {
  it.each([["", 2166136261], ["a", 3826002220], ["hello", 1335831723], ["foobar", 3214735720]] as const)("hashes %s with unsigned FNV-1a", (id, expected) => {
    expect(hashOf(id)).toBe(expected);
  });

  it.each(["", "visitor-123", "another visitor", "游客", "🦊"])("produces deterministic identities for %s", id => {
    expect(hashOf(id)).toBe(hashOf(id));
    expect(friendlyName(id)).toBe(friendlyName(id));
    expect(avatarOf(id)).toEqual(avatarOf(id));
  });

  it("makes two lowercase words and valid unsigned hashes", () => {
    for (const id of randomIds()) {
      expect(friendlyName(id)).toMatch(/^[a-z]+ [a-z]+$/);
      expect(Number.isInteger(hashOf(id))).toBe(true);
      expect(hashOf(id)).toBeGreaterThanOrEqual(0);
      expect(hashOf(id)).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("distributes 1000 random ids across the bodies and colours", () => {
    const avatars = randomIds().map(avatarOf);
    expect(new Set(avatars.map(avatar => avatar.body)).size).toBeGreaterThanOrEqual(18);
    expect(new Set(avatars.map(avatar => avatar.colour)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(avatars.map(avatar => `${avatar.body}:${avatar.colour}`)).size).toBeGreaterThan(150);
    for (const avatar of avatars) {
      expect(Object.hasOwn(PIXEL_BODIES, avatar.body)).toBe(true);
      expect(Object.hasOwn(ELECTRIC, avatar.colour)).toBe(true);
    }
  });
});
