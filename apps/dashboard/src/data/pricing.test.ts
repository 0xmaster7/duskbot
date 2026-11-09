import { expect, test } from "vitest";
import { wakeSeconds } from "./pricing";

test("wake seconds use tenths below ten seconds and whole seconds from ten", () => {
  for (const [ms, seconds] of [[40, "0.1"], [700, "0.7"], [4200, "4.2"], [1000, "1.0"], [9940, "9.9"], [10_000, "10"], [10_600, "11"], [42_200, "42"]] as const) {
    expect(wakeSeconds(ms)).toBe(seconds);
  }
});
