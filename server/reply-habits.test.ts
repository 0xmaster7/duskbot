import { expect, it } from "vitest";
import { REPLY_HABITS_PROMPT, TOOL_HABITS_PROMPT } from "./reply-habits.ts";

it("prefers batches for independent searches and keeps a native batching fallback", () => {
  expect(TOOL_HABITS_PROMPT).toContain("for 2 or more independent searches, prefer web_search_many when it is listed");
  expect(TOOL_HABITS_PROMPT).toContain("up to 10 queries in one call");
  expect(TOOL_HABITS_PROMPT).toContain("when its input supports multiple queries, put them together in one call");
  expect(REPLY_HABITS_PROMPT).toContain(TOOL_HABITS_PROMPT);
});

it("paces a turn in separate messages and leaves the steps to the status line", () => {
  expect(REPLY_HABITS_PROMPT).toContain("gets the answer at once, in one message, with no ack first");
  expect(REPLY_HABITS_PROMPT).toContain("the check you will do before sending");
  expect(REPLY_HABITS_PROMPT).toContain("At most one every 90 seconds");
  expect(REPLY_HABITS_PROMPT).toContain("put a line holding only --- between them");
  expect(REPLY_HABITS_PROMPT).toContain("a separate message starting \"Sources:\"");
  expect(TOOL_HABITS_PROMPT).toContain("Do not narrate steps; the status line shows what you are doing. Keep it current with set_status");
  expect(REPLY_HABITS_PROMPT).not.toContain("your tool calls show in the chat on their own");
  expect(REPLY_HABITS_PROMPT).not.toContain(String.fromCharCode(0x2014));
});
