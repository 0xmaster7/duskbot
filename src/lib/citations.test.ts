import { describe, expect, it } from "vitest";
import { withoutCitationMarkers } from "./citations";

const MARK = "<!--omb-citation-v1:eyJraW5kIjoiY2l0YXRpb24ifQ-->";

describe("messages sent with the old cite feature", () => {
  it("keep the quote and the comment, without the marker or the labels", () => {
    const stored = `Please look\n\n${MARK}\n> Quoted message:\n> first line\n>   second line\n\nComment:\nwhy this\n\n${MARK}\n> Quoted message:\n> another`;
    expect(withoutCitationMarkers(stored)).toBe("Please look\n\n> first line\n>   second line\n\nwhy this\n\n> another");
  });

  it("leave a quote-only message as a plain quote", () => {
    expect(withoutCitationMarkers(`${MARK}\n> Quoted message:\n> just this`)).toBe("> just this");
  });

  it("leave every other message alone", () => {
    const text = "> a normal quote\n\nComment:\nnot a citation";
    expect(withoutCitationMarkers(text)).toBe(text);
  });
});
