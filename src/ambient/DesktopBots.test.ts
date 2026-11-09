import { describe, expect, it } from "vitest";
import { busyBotNames, quitHintText } from "./DesktopBots";

describe("the ⌘Q pill", () => {
  it("names only the working bots the sidebar lists", () => {
    expect(busyBotNames([
      { name: "Scout", busy: true },
      { name: "Echo", busy: false },
      { name: "Ghost", busy: true, hidden: true },
      { name: "Moved", busy: true, movedTo: { kind: "cloud" } as never },
    ])).toEqual(["Scout"]);
  });

  it("names one, a few, or counts many, with the platform's key", () => {
    expect(quitHintText(["Scout"], true, "en")).toBe("Scout is working. Hold ⌘Q to quit.");
    expect(quitHintText(["Scout", "Echo"], false, "en")).toBe("Scout and Echo are working. Hold Ctrl+Q to quit.");
    expect(quitHintText(["A", "B", "C", "D"], true, "en")).toBe("4 bots are working. Hold ⌘Q to quit.");
  });
});
