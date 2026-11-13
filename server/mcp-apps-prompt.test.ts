import { describe, expect, it } from "vitest";

import { mcpServersPrompt } from "./mcp-apps-prompt.ts";
import { mcpServerLabel } from "./remote-mcp-label.ts";

const notion = { type: "http", url: "https://mcp.notion.com/mcp", headers: {} };
const todoist = { type: "http", url: "https://ai.todoist.net/mcp/", headers: {} };
const own = { command: "node", args: ["shop.mjs"] };

describe("mcpServersPrompt", () => {
  it("names a connected app as the app, says to work in it without asking, and to link what it made", () => {
    const text = mcpServersPrompt({ mounted: ["notion"], configured: { notion } });
    expect(text).toContain("The person connected Notion (search, read and write pages and databases; its tools are mcp__notion__…)");
    expect(text).toContain("even when the app isn't named");
    expect(text).toContain("link to it taken from the tool's result");
    expect(text).not.toContain("MCP server");
  });

  it("finds the app by the configured URL, not the turn's proxy address", () => {
    expect(mcpServersPrompt({ mounted: ["work"], configured: { work: notion } })).toContain("Notion (");
    expect(mcpServersPrompt({ mounted: ["shop"], configured: { shop: own } })).toContain('The user also added an MCP server for you: "shop".');
  });

  it("says which app needs reconnecting instead of leaving the bot to call it down", () => {
    const text = mcpServersPrompt({ mounted: ["notion"], configured: { notion, todoist }, needsSignIn: (name) => name === "todoist" });
    expect(text).toContain("The person's sign-in to Todoist has to be redone");
    expect(text).toContain("don't say the app is down");
    expect(text).toContain("reconnecting in Connect apps");
    expect(mcpServersPrompt({ mounted: [], configured: { todoist } })).toBe("");
  });

  it("is empty with no servers", () => {
    expect(mcpServersPrompt({ mounted: [], configured: {} })).toBe("");
  });
});

describe("mcpServerLabel", () => {
  it("is the catalog label for a catalog URL and the server name otherwise", () => {
    expect(mcpServerLabel("todoist", "https://ai.todoist.net/mcp")).toBe("Todoist");
    expect(mcpServerLabel("todoist-2", "https://ai.todoist.net/mcp?x=1")).toBe("todoist-2");
    expect(mcpServerLabel("shop", undefined)).toBe("shop");
  });
});
