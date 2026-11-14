import { describe, expect, it } from "vitest";

import { heldMemory, SNAPSHOT_IDLE_MS, takeMemoryDelta } from "./memory-snapshot.ts";

describe("memory held for a conversation", () => {
  it("keeps the first copy while the chat is active and tells the bot once what was saved meanwhile", () => {
    let notes = "- 2026-11-01 · Prefers tea";
    const now = 1_000_000;
    const read = () => ({ about: "My name is Ada.", notes, topics: "" });
    expect(heldMemory("k1", "s", read, now).notes).toBe(notes);
    notes = `${notes}\n- 2026-11-15 · Moved to Porto`;
    expect(heldMemory("k1", "s", read, now + 60_000).notes).toBe("- 2026-11-01 · Prefers tea");
    expect(takeMemoryDelta("k1")).toContain("+ - 2026-11-15 · Moved to Porto");
    expect(takeMemoryDelta("k1")).toBe("");
    heldMemory("k1", "s", read, now + 120_000);
    expect(takeMemoryDelta("k1")).toBe("");
    expect(heldMemory("k1", "s", read, now + 120_000 + SNAPSHOT_IDLE_MS + 1).notes).toBe(notes);
  });

  it("takes a fresh copy at once when a line was removed or replaced, and when the shape changes", () => {
    let about = "My name is Ada.\nLives in Lisbon.";
    const read = () => ({ about, notes: "", topics: "" });
    heldMemory("k2", "s", read, 0);
    about = "My name is Ada.";
    expect(heldMemory("k2", "s", read, 1).about).toBe("My name is Ada.");
    about = "My name is Ada.\nLikes figs.";
    expect(heldMemory("k2", "s", read, 2).about).toBe("My name is Ada.");
    expect(heldMemory("k2", "other", read, 3).about).toBe("My name is Ada.\nLikes figs.");
  });
});
