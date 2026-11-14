import { describe, expect, it } from "vitest";
import { retryLine } from "./retry-line.ts";

describe("retryLine", () => {
  it("says when and why in plain words, never the engine's code", () => {
    expect(retryLine(undefined, { attempt: 1, delayMs: 2_600, reason: "overloaded" })).toBe("Trying again in 3s (attempt 2 of 3). The AI is busy right now.");
    expect(retryLine(undefined, { attempt: 1, delayMs: 0, reason: "request_too_large" }))
      .toBe("Trying again now (attempt 2 of 3). The conversation was too long to send, so a shorter copy goes instead.");
  });

  it("words a reason it does not know generally, whatever the engine sent", () => {
    for (const reason of ["provider_hiccup", "stream disconnected before completion", "toString"]) {
      const line = retryLine(undefined, { attempt: 2, delayMs: 4_000, reason });
      expect(line).toBe("Trying again in 4s (attempt 3 of 3). The AI did not answer properly.");
    }
  });

  it("never counts past its own total", () => {
    expect(retryLine(undefined, { attempt: 4, delayMs: 1_000, reason: "timeout" })).toBe("Trying again in 1s (attempt 5 of 5). The AI took too long to answer.");
  });
});
