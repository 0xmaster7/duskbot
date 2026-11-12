import { describe, expect, it } from "vitest";

import { computerStartLine } from "./computer-start";

describe("computerStartLine", () => {
  it("names the bot's cloud computer while it is created or woken", () => {
    expect(computerStartLine({ state: "provisioning", place: "cloud" }, "Scout"))
      .toBe("starting Scout's cloud desktop. the first start takes about a minute.");
    expect(computerStartLine({ state: "waking", place: "cloud" }, "Scout")).toBe("waking Scout's cloud desktop…");
  });

  it("keeps the Local VM's line, and shows nothing when nothing is starting", () => {
    expect(computerStartLine({ state: "provisioning" }, "Scout")).toBe("setting up this bot's desktop…");
    expect(computerStartLine(undefined, "Scout")).toBeNull();
  });
});
