import { describe, expect, it } from "vitest";
import { drawUserAvatar, newAvatarSeed, parseUserAvatarChoice, seededRandom, userAvatarFace } from "./user-avatar";

describe("user avatars", () => {
  it("draw the same picture for the same seed, and different ones for different seeds", () => {
    expect(drawUserAvatar("acc_1")).toEqual(drawUserAvatar("acc_1"));
    const pictures = new Set(Array.from({ length: 200 }, (_, i) => drawUserAvatar(`acc_${i}`).cells.join()));
    expect(pictures.size).toBeGreaterThan(190);
    const { size, cells } = drawUserAvatar("acc_1");
    expect(cells).toHaveLength(size * size);
  });

  it("take only a photo or a drawn seed as a choice", () => {
    expect(parseUserAvatarChoice("photo")).toBe("photo");
    expect(parseUserAvatarChoice("g:k3x9a0bz")).toBe("g:k3x9a0bz");
    for (const bad of ["", "g:", "g:UP", "g:a/b", `g:${"a".repeat(17)}`, "https://example.test/a.png", 7, null]) expect(parseUserAvatarChoice(bad)).toBeNull();
    const seed = newAvatarSeed(seededRandom("x"));
    expect(parseUserAvatarChoice(`g:${seed}`)).toBe(`g:${seed}`);
  });

  it("show a picked drawing, the sign-in photo only when chosen, else the drawing seeded from the account id", () => {
    expect(userAvatarFace({ id: "a", avatarUrl: "https://p.test/a.png", avatar: "g:abc" })).toEqual({ kind: "drawn", seed: "abc" });
    expect(userAvatarFace({ id: "a", avatarUrl: "https://p.test/a.png", avatar: "photo" })).toEqual({ kind: "photo", url: "https://p.test/a.png" });
    expect(userAvatarFace({ id: "a", avatarUrl: "https://p.test/a.png" })).toEqual({ kind: "drawn", seed: "a" });
    expect(userAvatarFace({ id: "a", avatar: "photo" })).toEqual({ kind: "drawn", seed: "a" });
    expect(userAvatarFace({ id: "a" })).toEqual({ kind: "drawn", seed: "a" });
  });
});
