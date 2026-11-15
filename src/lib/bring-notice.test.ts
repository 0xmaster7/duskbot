import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { bringNoticeFind } from "./bring-notice";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const DAY = 86_400_000;

describe("the bring card", () => {
  it("is about the best source used lately with enough in it, and nothing when no source passes", () => {
    setLocale("en");
    expect(bringNoticeFind(null, NOW)).toBeNull();
    expect(bringNoticeFind({ skills: [], tools: Array.from({ length: 6 }, (_, i) => ({ name: `t${i}`, source: "cursor" as const })), activity: { cursor: NOW } }, NOW), "a few MCP servers").toBeNull();
    const idle = { skills: Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, source: "windsurf" as const })), tools: [], activity: { windsurf: NOW - 60 * DAY } };
    expect(bringNoticeFind(idle, NOW), "not used in two months").toBeNull();
    const found = bringNoticeFind({ ...idle, memory: [{ source: "claudeCode", files: 4, notes: 40 }], activity: { ...idle.activity, claudeCode: NOW - DAY } }, NOW);
    expect(found).toMatchObject({ app: "Claude Code", summary: "40 notes about you", strong: true });
  });
});
