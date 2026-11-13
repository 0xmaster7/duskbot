import { expect, it } from "vitest";
import { agentsToolList } from "./drivers/agents-mcp.ts";
import { chiefOfStaffSystemPrompt } from "./chief-of-staff.ts";
import { HANDOFF_BRIEF_RULE } from "./handoff-brief.ts";
import { peerRosterSystemPrompt } from "./peer-roster.ts";
import { leaderSystemNote } from "./room-leader.ts";

it("every prompt that hands work on says a brief stands alone: goal, what is done, what is needed", () => {
  for (const words of ["the goal", "already done or found", "what you need back"]) expect(HANDOFF_BRIEF_RULE).toContain(words);
  expect(HANDOFF_BRIEF_RULE).not.toContain("\u2014");
  expect(peerRosterSystemPrompt([])).toContain(HANDOFF_BRIEF_RULE);
  expect(chiefOfStaffSystemPrompt("chief", [], true)).toContain(HANDOFF_BRIEF_RULE);
  expect(leaderSystemNote({ id: "a", name: "Ada" }, [], "the person")).toContain(HANDOFF_BRIEF_RULE);
});

it("coordinate_bots asks for a message that stands alone", () => {
  const tool = agentsToolList({}).available.find((entry) => entry.name === "coordinate_bots");
  const message = (tool!.inputSchema as unknown as { properties: { message: { description: string } } }).properties.message.description;
  expect(message).toContain("standing alone: the goal, what is already done or found, and what you need back");
});
