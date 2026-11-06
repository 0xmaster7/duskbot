import { describe, expect, it } from "vitest";

import { keyboardInset } from "./phone-viewport";

describe("keyboardInset", () => {
  it("is the height the keyboard covers", () => {
    expect(keyboardInset(844, { height: 508, scale: 1 })).toBe(336);
  });

  it("ignores pinch zoom, which shrinks the visual viewport without a keyboard", () => {
    expect(keyboardInset(844, { height: 422, scale: 2 })).toBe(0);
  });

  it("ignores browser chrome sliding in and out", () => {
    expect(keyboardInset(844, { height: 790, scale: 1 })).toBe(0);
  });
});
