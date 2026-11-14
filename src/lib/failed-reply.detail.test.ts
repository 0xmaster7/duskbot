import { describe, expect, it } from "vitest";
import { failedReplyDetail } from "./failed-reply";

describe("a failed reply's line", () => {
  it("names the AI that couldn't be reached, never dusk bot", () => {
    for (const cause of ["fetch failed", "TypeError: fetch failed", "connect ECONNREFUSED 127.0.0.1:11434"]) {
      const line = failedReplyDetail("other", "My server", true, cause);
      expect(line).toBe("Couldn't reach My server. Check its address and that it's running where your bot runs, then try again.");
      expect(line).not.toMatch(/dusk bot/i);
    }
  });

  it("keeps other causes as they were", () => {
    expect(failedReplyDetail("other", "My server", true, "502 Bad Gateway")).toBe("Something went wrong on the other end. Try again.");
    expect(failedReplyDetail("other", "My server", true, "The model refused this request.")).toBe("The model refused this request.");
  });
});
