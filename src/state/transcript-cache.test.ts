import { expect, it } from "vitest";
import { shownTranscript } from "./snapshot-navigation";
import { reconcileTranscript, reuseMessages } from "./transcript-cache";
import type { Message } from "./store";

const line = (id: string, text = id): Message => ({ id, role: "bot", kind: "text", text, at: 1 });

it("draws nothing of a conversation held only as its preview", () => {
  const preview = { messages: [line("last")], transcriptLoaded: false };
  expect(shownTranscript(preview).messages).toEqual([]);
  const loaded = { messages: [line("last")], transcriptLoaded: true };
  expect(shownTranscript(loaded)).toBe(loaded);
});

it("keeps every unchanged message object and the array itself when nothing changed", () => {
  const current = [line("a"), line("b")];
  expect(reuseMessages(current, [line("a"), line("b")])).toBe(current);
  const edited = reuseMessages(current, [line("a"), line("b", "edited")]);
  expect(edited[0]).toBe(current[0]);
  expect(edited[1]!.text).toBe("edited");
});

it("confirms a cached transcript with the newest page: older history stays above, the page patches and appends", () => {
  const current = [line("old"), line("a"), line("b", "before")];
  const { messages, hasMore } = reconcileTranscript(current, new Set(current), [line("a"), line("b", "after"), line("c")], true, false);
  expect(messages.map((message) => message.text)).toEqual(["old", "a", "after", "c"]);
  expect(messages[0]).toBe(current[0]);
  expect(messages[1]).toBe(current[1]);
  expect(hasMore).toBe(true);
});

it("takes the page alone when it is the whole conversation or no longer reaches the cached rows", () => {
  const current = [line("old"), line("a")];
  expect(reconcileTranscript(current, new Set(current), [line("a"), line("b")], false, true).messages.map((m) => m.id)).toEqual(["a", "b"]);
  const gap = reconcileTranscript(current, new Set(current), [line("x"), line("y")], true, false);
  expect(gap.messages.map((m) => m.id)).toEqual(["x", "y"]);
  expect(gap.hasMore).toBe(true);
});
