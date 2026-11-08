import { expect, it } from "vitest";
import { REPLY_HABITS_PROMPT, TOOL_HABITS_PROMPT } from "./reply-habits.ts";

it("prefers batches for independent searches and keeps a native batching fallback", () => {
  expect(TOOL_HABITS_PROMPT).toContain("for 2 or more independent searches, prefer web_search_many when it is listed");
  expect(TOOL_HABITS_PROMPT).toContain("up to 10 queries in one call");
  expect(TOOL_HABITS_PROMPT).toContain("when its input supports multiple queries, put them together in one call");
  expect(REPLY_HABITS_PROMPT).toContain(TOOL_HABITS_PROMPT);
});
