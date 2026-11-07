import { expect, it } from "vitest";
import { shownTranscript } from "./snapshot-navigation";
import { CACHED_THREAD_BYTES, CACHED_THREADS, cacheEntry, createTranscriptCache, reconcileTranscript, reuseMessages, type CachedTranscript, type TranscriptShelf } from "./transcript-cache";
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

function memoryShelf(initial: Array<CachedTranscript & { bytes: number }> = []) {
  const stored = new Map(initial.map((entry) => [entry.threadId, entry]));
  return {
    stored,
    shelf: {
      read: async () => [...stored.values()],
      write: async (put: ReadonlyArray<CachedTranscript & { bytes: number }>, remove: readonly string[]) => {
        for (const entry of put) stored.set(entry.threadId, entry);
        for (const threadId of remove) stored.delete(threadId);
      },
    } satisfies TranscriptShelf,
  };
}

it("saves nothing until the workspace is known to be the person's own, then only the newest 30", async () => {
  const { stored, shelf } = memoryShelf();
  let clock = 0;
  const cache = createTranscriptCache(shelf, { delayMs: 0, now: () => (clock += 1) });
  for (let index = 0; index < 35; index += 1) cache.remember(`t${index}`, [line(`m${index}`)], false, null);
  await cache.flush();
  expect(stored.size).toBe(0);
  cache.setEnabled(true);
  await cache.flush();
  expect(stored.size).toBe(CACHED_THREADS);
  expect(stored.has("t34")).toBe(true);
  expect(stored.has("t0")).toBe(false);
  cache.touch("t0");
  await cache.flush();
  expect(stored.has("t0")).toBe(true);
  expect(stored.size).toBe(CACHED_THREADS);
});

it("reads the shelf back on the next launch, and empties it on a shared workspace", async () => {
  const { stored, shelf } = memoryShelf([cacheEntry("kept", [line("a"), line("b")], true, "b", 5)]);
  const cache = createTranscriptCache(shelf, { delayMs: 0 });
  await cache.loaded;
  expect(cache.get("kept")?.messages.map((message) => message.id)).toEqual(["a", "b"]);
  cache.setEnabled(true);
  cache.setEnabled(false);
  await cache.flush();
  expect(stored.size).toBe(0);
});

it("keeps a transcript's newest messages within a size budget and clips long tool output", () => {
  const huge = "x".repeat(4_000);
  const rows: Message[] = Array.from({ length: 260 }, (_, index) => index === 259
    ? { id: "tool", role: "bot", kind: "activity", at: 1, tool: { name: "Bash", output: huge } }
    : line(`m${index}`, huge));
  const entry = cacheEntry("t", rows, false, null, 1);
  expect(entry.bytes).toBeLessThanOrEqual(CACHED_THREAD_BYTES);
  expect(entry.messages.at(-1)!.tool!.output!.length).toBe(1_000);
  expect(entry.messages.at(-1)!.tool!.clipped).toBe(true);
  expect(entry.hasMore).toBe(true);
});
