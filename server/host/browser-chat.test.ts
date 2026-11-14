import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserChat } from "./browser-chat.ts";

const shot = (data: string) => ({ content: [{ type: "text", text: "/tmp/shot.png" }, { type: "image", data, mimeType: "image/png" }] });

function chat(over: Partial<Parameters<typeof createBrowserChat>[0]> = {}) {
  const posted: string[] = [];
  const closed: string[] = [];
  const browser = createBrowserChat({
    postScreen: (_thread, frame) => { posted.push(frame.png); },
    stillNeeded: () => false,
    runningSession: () => "s",
    closeThreadTabs: async (_session, threadId) => { closed.push(threadId); return "closed"; },
    graceMs: 1_000,
    ...over,
  });
  return { browser, posted, closed };
}

afterEach(() => { vi.useRealTimers(); });

describe("the bot's screenshots in its chat", () => {
  it("posts up to four a turn, skips the same picture twice in a row, and says when one was posted", () => {
    const { browser, posted } = chat();
    for (const data of ["a", "a", "b", "c", "d", "e"]) browser.screenshot("t", "g1", shot(data));
    expect(posted).toEqual(["a", "b", "c", "d"]);
    expect(browser.postedScreenshot("t", "g1")).toBe(true);
    expect(browser.postedScreenshot("t", "g2")).toBe(false);
    browser.screenshot("t", "g2", shot("e"));
    expect(posted.at(-1)).toBe("e");
    browser.screenshot("t", "g2", { isError: true, content: [{ type: "image", data: "f", mimeType: "image/png" }] });
    expect(posted).toHaveLength(5);
  });
});

describe("a finished conversation's tabs", () => {
  it("close after the grace when the turn used the browser and nothing waits on the person", async () => {
    vi.useFakeTimers();
    const { browser, closed } = chat();
    browser.turnEnded("b", "quiet");
    browser.used("t");
    browser.turnEnded("b", "t");
    await vi.advanceTimersByTimeAsync(999);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toEqual(["t"]);
  });

  it("stay while the conversation waits on the person, and are tried again while someone watches", async () => {
    vi.useFakeTimers();
    const waiting = chat({ stillNeeded: () => true });
    waiting.browser.used("t");
    waiting.browser.turnEnded("b", "t");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(waiting.closed).toEqual([]);

    let watched = true;
    const tries: string[] = [];
    const viewer = chat({ closeThreadTabs: async (_s, threadId) => { tries.push(threadId); return watched ? "kept" : "closed"; } });
    viewer.browser.used("t");
    viewer.browser.turnEnded("b", "t");
    await vi.advanceTimersByTimeAsync(1_000);
    watched = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tries).toEqual(["t", "t"]);
  });
});
