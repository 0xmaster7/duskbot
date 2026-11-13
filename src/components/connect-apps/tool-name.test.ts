import { expect, it } from "vitest";

import { toolName } from "./AppPage";

it("writes tool names in sentence case, keeping names and acronyms", () => {
  expect(toolName("New Channel Created Trigger", "Slack")).toBe("New channel created trigger");
  expect(toolName("Create Slack Canvas", "Slack")).toBe("Create Slack canvas");
  expect(toolName("Test Slack API connection", "Slack")).toBe("Test Slack API connection");
  expect(toolName("Upload File To Google Drive", "Google Drive")).toBe("Upload file to Google Drive");
  expect(toolName("list GitHub Repos", "GitHub")).toBe("List GitHub repos");
});
