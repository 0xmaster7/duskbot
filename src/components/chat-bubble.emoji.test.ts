import { describe, expect, it } from "vitest";
import { emojiOnly } from "./chat-bubble";

describe("emojiOnly", () => {
  it("takes one to three emoji, with skin tones, joiners and flags", () => {
    for (const text of ["🙂", " 👍 ", "😂😂😂", "👍🏽", "👨‍👩‍👧", "🇮🇳", "❤️"]) expect(emojiOnly(text), text).toBe(true);
  });
  it("leaves words, digits, long runs and empty text in a bubble", () => {
    for (const text of ["ok 👍", "123", "#", "😂😂😂😂", "", ":)"]) expect(emojiOnly(text), text).toBe(false);
  });
});
