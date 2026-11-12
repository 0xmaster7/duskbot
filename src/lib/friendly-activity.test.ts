import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { friendlyNowPhrases, toolService } from "./friendly-activity";

const running = (name: string, extra: Partial<NonNullable<Message["tool"]>> = {}): Message =>
  ({ id: "m", role: "bot", kind: "activity", at: 1, tool: { name, ...extra } });

describe("Simple mode's working line", () => {
  it("says something friendly while nothing is reported, from grok's working pool, and thinking from its thinking pool", () => {
    expect(friendlyNowPhrases(null)).toEqual({ phase: "friendly:generic", phrases: ["working on it", "chipping away", "getting it done", "making progress", "handling it"] });
    expect(friendlyNowPhrases({ activity: "thinking" })).toEqual({ phase: "friendly:thinking", phrases: ["thinking it through", "mulling it over", "putting it together"] });
  });

  it("names the kind of work in plain words, never a file name or size", () => {
    expect(friendlyNowPhrases({ activity: "reply" }).phrases).toEqual(["typing…"]);
    expect(friendlyNowPhrases({ activity: "command", itemId: "x" }).phrases).toEqual(["running a few commands"]);
    expect(friendlyNowPhrases({ activity: "write", file: "index.html", bytes: 14_000, itemId: "w" }).phrases).toEqual(["writing some code"]);
    expect(friendlyNowPhrases({ activity: "read", file: "notes.md", itemId: "r" }).phrases).toEqual(["digging around"]);
    expect(friendlyNowPhrases({ activity: "web", itemId: "s" }).phrases).toEqual(["digging around"]);
    expect(friendlyNowPhrases(null, running("Bash")).phrases).toEqual(["running a few commands"]);
    expect(friendlyNowPhrases(null, running("mcp__computer__click")).phrases).toEqual(["clicking around"]);
    expect(friendlyNowPhrases(null, running("delegate_bot")).phrases).toEqual(["checking in with the team"]);
  });

  it("reads a step by its tool, not the narration the server writes for calls", () => {
    expect(friendlyNowPhrases(null, running("Bash", { spoken: "running a command" })).phrases).toEqual(["running a few commands"]);
  });

  it("never says the command, search or address itself, as grok's line does not", () => {
    expect(friendlyNowPhrases({ activity: "command", itemId: "x", target: "scrape.py" }).phrases).toEqual(["running a few commands"]);
    expect(friendlyNowPhrases({ activity: "web", itemId: "s", target: "Acme construction leads" }).phrases).toEqual(["digging around"]);
    expect(friendlyNowPhrases(null, running("WebFetch", { step: { activity: "fetch", target: "linkedin.com" } })).phrases).toEqual(["digging around"]);
    expect(friendlyNowPhrases(null, running("Write", { step: { activity: "write", target: "report.md" } })).phrases).toEqual(["writing some code"]);
  });

  it("says which outside service the bot is working in", () => {
    expect(toolService("mcp__notion__search")).toBe("Notion");
    expect(toolService("mcp__composio__GMAIL_SEND_EMAIL")).toBe("Gmail");
    expect(toolService("mcp__dusk__ask_user")).toBeNull();
    expect(toolService("Bash")).toBeNull();
    expect(friendlyNowPhrases(null, running("mcp__notion__search")).phrases).toEqual(["working in Notion"]);
  });
});
