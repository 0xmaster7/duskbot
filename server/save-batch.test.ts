import { describe, expect, it, vi } from "vitest";

import { batchSaves, flushDeferredSaves, saveDeferred, saveSoon } from "./save-batch.ts";

describe("batchSaves", () => {
  it("writes at once outside a batch, and once per file when the outermost batch returns", () => {
    const writes: string[] = [];
    const a = {}, b = {};
    saveSoon(a, () => writes.push("a0"));
    expect(writes).toEqual(["a0"]);
    batchSaves(() => {
      saveSoon(a, () => writes.push("a1"));
      batchSaves(() => saveSoon(b, () => writes.push("b1")));
      saveSoon(a, () => writes.push("a2"));
      expect(writes).toEqual(["a0"]);
    });
    expect(writes).toEqual(["a0", "a2", "b1"]);
  });

  it("writes what was asked for when the batch throws, and a failed write never stops the others", () => {
    const writes: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => batchSaves(() => {
      saveSoon({}, () => { throw new Error("disk full"); });
      saveSoon({}, () => writes.push("b"));
      throw new Error("listener");
    })).toThrow("listener");
    expect(writes).toEqual(["b"]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("hands back what the batch returned", () => {
    expect(batchSaves(() => 42)).toBe(42);
  });
});

describe("saveDeferred", () => {
  it("makes every change within its window one write of the latest state, and a flush writes it at once", () => {
    vi.useFakeTimers();
    try {
      const writes: string[] = [];
      const file = {};
      for (let i = 0; i < 50; i++) saveDeferred(file, () => writes.push(`v${i}`), 1_000);
      expect(writes).toEqual([]);
      vi.advanceTimersByTime(1_000);
      expect(writes).toEqual(["v49"]);
      saveDeferred(file, () => writes.push("late"), 1_000);
      flushDeferredSaves();
      expect(writes).toEqual(["v49", "late"]);
      vi.advanceTimersByTime(5_000);
      expect(writes).toEqual(["v49", "late"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
