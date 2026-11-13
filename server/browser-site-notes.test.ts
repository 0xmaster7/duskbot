import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { landingSite, siteNotes, withSiteNotes } from "./browser-site-notes.ts";
import { memoryLinesMentioning, workspaceDir, writeMemoryFile, writeMemoryTopic } from "./workspace.ts";

const onDisk = (memoryIds: (botId: string, threadId: string) => readonly string[]) => ({ memoryIds, lines: memoryLinesMentioning });

describe("site notes on browser landing", () => {
  it("names the site a landing call goes to, by its registrable domain", () => {
    expect(landingSite("agent_browser_open", { url: "https://docs.github.com/en/pages" })).toBe("github.com");
    expect(landingSite("agent_browser_navigate", { url: "https://www.bbc.co.uk/news" })).toBe("bbc.co.uk");
    expect(landingSite("agent_browser_click", { url: "https://github.com" })).toBeNull();
    expect(landingSite("agent_browser_navigate", { action: "back" })).toBeNull();
    expect(landingSite("agent_browser_open", { url: "file:///etc/passwd" })).toBeNull();
    expect(landingSite("agent_browser_open", { url: "http://localhost:3000/" })).toBeNull();
  });

  it("shows up to 3 lines from the bot's topic notes and archive, never MEMORY.md, which loads every turn anyway", () => {
    writeMemoryFile("bot-sn-a", "# Memory\n- 2026-10-01 · github.com login is through Google SSO\n");
    writeMemoryTopic("bot-sn-a", "sites.md", "---\ntitle: Sites\n---\n- 2026-10-02 · On github.com the release page is under /releases/new\n- 2026-10-03 · unrelated line about lunch\n");
    writeFileSync(join(workspaceDir("bot-sn-a"), "memory", "archive.md"), "- 2026-09-01 · github.com rate limits uploads over 25 MB\n");
    const notes = siteNotes(onDisk((id) => [id]), "bot-sn-a", "t1", "github.com");
    expect(notes).toContain("From your notes on github.com");
    expect(notes).toContain("release page is under /releases/new");
    expect(notes).toContain("rate limits uploads over 25 MB");
    expect(notes).not.toContain("Google SSO");
    expect(notes).not.toContain("lunch");
    expect(siteNotes(onDisk((id) => [id]), "bot-sn-a", "t1", "example.org")).toBeNull();
  });

  it("never shows another bot's notes, even when a source names that bot's folders", () => {
    writeMemoryTopic("bot-sn-own", "sites.md", "- 2026-10-02 · stripe.com dashboard needs the work account\n");
    writeMemoryTopic("bot-sn-other", "sites.md", "- 2026-10-02 · stripe.com SECRET-OTHER-BOT note\n");
    writeMemoryTopic("bot-sn-other--room-r1", "sites.md", "- 2026-10-02 · stripe.com OTHER-BOT room note\n");
    writeMemoryTopic("bot-sn-own--room-r1", "sites.md", "- 2026-10-02 · stripe.com own room layer note\n");
    const hostile = onDisk(() => ["bot-sn-other", "bot-sn-other--room-r1", "bot-sn-own", "bot-sn-own--room-r1", "bot-sn-own-x"]);
    const notes = siteNotes(hostile, "bot-sn-own", "t1", "stripe.com") ?? "";
    expect(notes).toContain("needs the work account");
    expect(notes).toContain("own room layer note");
    expect(notes).not.toContain("OTHER-BOT");
    expect(siteNotes(onDisk(() => ["bot-sn-other"]), "bot-sn-own", "t1", "stripe.com")).toBeNull();
    expect(siteNotes(onDisk((id) => [id]), "", "t1", "stripe.com")).toBeNull();
  });

  it("adds notes after a landing that worked, and leaves a failed one alone", () => {
    const ok = { content: [{ type: "text", text: "Opened" }] };
    expect(withSiteNotes(ok, "From your notes on x.com:\n- a")).toEqual({ content: [{ type: "text", text: "Opened" }, { type: "text", text: "From your notes on x.com:\n- a" }] });
    const failed = { isError: true, content: [{ type: "text", text: "nope" }] };
    expect(withSiteNotes(failed, "notes")).toBe(failed);
    expect(withSiteNotes(ok, null)).toBe(ok);
  });
});
