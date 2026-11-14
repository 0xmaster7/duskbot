import { describe, expect, it } from "vitest";
import { AVATAR_SKINS, AVATAR_TILES, avatarDistance, avatarLightness, avatarReadable, drawUserAvatar, newAvatarSeed, parseUserAvatarChoice, seededRandom, userAvatarFace } from "./user-avatar";

describe("user avatars", () => {
  it("draw the same head for the same seed, and thousands of different heads", () => {
    expect(drawUserAvatar("acc_1")).toEqual(drawUserAvatar("acc_1"));
    const heads = Array.from({ length: 3000 }, (_, i) => drawUserAvatar(`acc_${i}`));
    expect(new Set(heads.map((head) => head.cells.join())).size).toBeGreaterThan(2900);
    for (const head of heads) {
      expect(head.size).toBe(16);
      expect(head.cells).toHaveLength(256);
      for (const cell of head.cells) expect(cell).toMatch(/^#[0-9a-f]{6}$/);
    }
    // every trait shows up, the rares rarely
    const count = (key: "shape" | "mood" | "gear" | "skin", value: string) => heads.filter((head) => head.traits[key] === value).length;
    for (const shape of ["round", "tall", "wide", "pointy", "angular", "block", "lean"]) expect(count("shape", shape)).toBeGreaterThan(0);
    for (const mood of ["chill", "smirk", "side-eye", "determined", "sleepy", "mischief", "shades", "unimpressed", "wink", "shout", "monocle"]) expect(count("mood", mood)).toBeGreaterThan(0);
    for (const rare of ["crown", "halo"]) { expect(count("gear", rare)).toBeGreaterThan(0); expect(count("gear", rare)).toBeLessThan(150); }
    expect(count("skin", "gold")).toBeLessThan(150);
  });

  it("never draw an ugly combination: a head on its own hue, a head too close to its tile, or a face lost in its skin", () => {
    for (let i = 0; i < 3000; i++) {
      const { head, tileOf, tile } = drawUserAvatar(`acc_${i}`);
      expect(tile).toBe(tileOf.color);
      expect(avatarReadable(head, tileOf)).toBe(true);
      expect(tileOf.family.replace(/^deep-/, "")).not.toBe(head.family);
      expect(avatarDistance(head.fill, tileOf.color)).toBeGreaterThanOrEqual(0.14);
      expect(Math.abs(avatarLightness(head.ink) - avatarLightness(head.fill))).toBeGreaterThanOrEqual(0.4);
    }
    // every skin has somewhere to stand
    for (const [skin] of AVATAR_SKINS) expect(AVATAR_TILES.some((tile) => avatarReadable(skin, tile))).toBe(true);
  });

  it("keep the head inside the round crop: the corners stay tile", () => {
    for (let i = 0; i < 500; i++) {
      const { cells, tile } = drawUserAvatar(`acc_${i}`);
      for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]] as const) expect(cells[y * 16 + x]).toBe(tile);
    }
  });

  it("take only a photo or a drawn seed as a choice", () => {
    expect(parseUserAvatarChoice("photo")).toBe("photo");
    expect(parseUserAvatarChoice("drawn")).toBe("drawn");
    expect(parseUserAvatarChoice("g:k3x9a0bz")).toBe("g:k3x9a0bz");
    for (const bad of ["", "g:", "g:UP", "g:a/b", `g:${"a".repeat(17)}`, "https://example.test/a.png", 7, null]) expect(parseUserAvatarChoice(bad)).toBeNull();
    const seed = newAvatarSeed(seededRandom("x"));
    expect(parseUserAvatarChoice(`g:${seed}`)).toBe(`g:${seed}`);
  });

  it("show the sign-in photo by default, a picked drawing over it, and the account id's drawing only without a photo or by choice", () => {
    expect(userAvatarFace({ id: "a", avatarUrl: "https://p.test/a.png" })).toEqual({ kind: "photo", url: "https://p.test/a.png" });
    expect(userAvatarFace({ id: "a", avatarUrl: "https://p.test/a.png", avatar: "g:abc" })).toEqual({ kind: "drawn", seed: "abc" });
    expect(userAvatarFace({ id: "a", avatarUrl: "https://p.test/a.png", avatar: "photo" })).toEqual({ kind: "photo", url: "https://p.test/a.png" });
    expect(userAvatarFace({ id: "a", avatarUrl: "https://p.test/a.png", avatar: "drawn" })).toEqual({ kind: "drawn", seed: "a" });
    expect(userAvatarFace({ id: "a", avatar: "drawn" })).toEqual({ kind: "drawn", seed: "a" });
    expect(userAvatarFace({ id: "a", avatar: "photo" })).toEqual({ kind: "drawn", seed: "a" });
    expect(userAvatarFace({ id: "a" })).toEqual({ kind: "drawn", seed: "a" });
  });
});
