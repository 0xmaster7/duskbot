import { describe, expect, it } from "vitest";
import { bringNoticeApps } from "./bring-notice";

describe("the bring card", () => {
  it("is worth showing for memory notes or skills not brought in, never for MCP servers alone", () => {
    expect(bringNoticeApps(null)).toEqual([]);
    expect(bringNoticeApps({ skills: [], tools: [{ name: "notion", source: "cursor" }] })).toEqual([]);
    expect(bringNoticeApps({ skills: [{ name: "pdf", source: "codex" }], tools: [], memory: [{ source: "claudeCode", files: 2, notes: 40 }, { source: "gemini", files: 1, notes: 0 }] }))
      .toEqual(["claudeCode", "codex"]);
  });
});
