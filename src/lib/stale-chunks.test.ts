import { expect, it } from "vitest";
import { isStaleChunkError, reloadForStaleChunks } from "./stale-chunks";

it("knows a failed lazy import from other errors", () => {
  expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: http://x/node_modules/.vite/deps/@hpke_core.js?v=1"))).toBe(true);
  expect(isStaleChunkError(new Error("Importing a module script failed."))).toBe(true);
  expect(isStaleChunkError(new Error("network down"))).toBe(false);
});

it("reloads once, then leaves a repeat within a minute alone", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  let reloads = 0;
  expect(reloadForStaleChunks(storage, 1_000_000, () => reloads++)).toBe(true);
  expect(reloadForStaleChunks(storage, 1_030_000, () => reloads++)).toBe(false);
  expect(reloadForStaleChunks(storage, 1_100_000, () => reloads++)).toBe(true);
  expect(reloads).toBe(2);
});
