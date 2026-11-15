import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { bringNoticeFind } from "./bring-notice";

const NOW = Date.parse("2026-11-15T12:00:00Z");

describe("the bring card", () => {
  it("is about the app the person really uses that knows them, and nothing when none is used enough", () => {
    setLocale("en");
    const memory = [{ source: "claudeCode" as const, files: 4, notes: 40, topics: { preferences: true, aboutYou: false, workStyle: true, projects: 0 } }];
    expect(bringNoticeFind(null, NOW)).toBeNull();
    expect(bringNoticeFind({ skills: [], tools: [], memory, usage: { claudeCode: 3 } }, NOW), "used on 3 days only").toBeNull();
    expect(bringNoticeFind({ skills: Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, source: "codex" as const })), tools: [], usage: { codex: 20 } }, NOW), "skills, no memory").toBeNull();
    expect(bringNoticeFind({ skills: [], tools: [], memory, usage: { claudeCode: 18 } }, NOW)).toMatchObject({ app: "Claude Code", activeDays: 18 });
  });
});
