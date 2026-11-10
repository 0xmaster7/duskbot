import { describe, expect, it } from "vitest";

import { replyBubbles } from "./reply-bubbles.ts";

describe("replyBubbles", () => {
  it("leaves text with no separator exactly as it came", () => {
    expect(replyBubbles("On it, checking prices now.")).toEqual(["On it, checking prices now."]);
    expect(replyBubbles("  spaced\n\n")).toEqual(["  spaced\n\n"]);
    expect(replyBubbles("")).toEqual([""]);
    expect(replyBubbles("a --- b\n----\n-- -")).toEqual(["a --- b\n----\n-- -"]);
  });

  it("splits on a line holding only ---, in order, trimmed, empty parts dropped", () => {
    expect(replyBubbles("The cheapest fare is ₹8,656.\n---\nNothing was booked.")).toEqual(["The cheapest fare is ₹8,656.", "Nothing was booked."]);
    expect(replyBubbles("---\nfirst\n\n---\n\n---\nsecond\n---  \n")).toEqual(["first", "second"]);
    expect(replyBubbles("one\r\n---\r\ntwo")).toEqual(["one", "two"]);
    expect(replyBubbles("---\n---")).toEqual([]);
  });

  it("keeps a separator inside a fenced code block", () => {
    const yaml = "Here is the file:\n```yaml\n---\ntitle: x\n```\n---\nSources: The Verge";
    expect(replyBubbles(yaml)).toEqual(["Here is the file:\n```yaml\n---\ntitle: x\n```", "Sources: The Verge"]);
    const nested = "````md\n```\n---\n```\n````\n---\nafter";
    expect(replyBubbles(nested)).toEqual(["````md\n```\n---\n```\n````", "after"]);
    expect(replyBubbles("~~~\n---\n~~~")).toEqual(["~~~\n---\n~~~"]);
  });

  it("treats an unclosed fence as code to the end", () => {
    expect(replyBubbles("before\n---\n```\n---\nstill code")).toEqual(["before", "```\n---\nstill code"]);
  });
});
