import { describe, expect, it } from "vitest";
import { toolStepLabel } from "./tool-step-label";

describe("toolStepLabel", () => {
  it.each([
    [{ name: "Bash", summary: "pnpm test" }, "Run a command"],
    [{ name: "pwd", summary: "pwd" }, "Run a command"],
    [{ name: "Read" }, "Read a file"],
    [{ name: "WebSearch" }, "Search the web"],
    [{ name: "mcp__dusk__computer_batch" }, "Use the screen"],
    [{ name: "mcp__dusk__screenshot" }, "Look at the screen"],
    [{ name: "mcp__claude_ai_Gmail__list_bots" }, "Check the team"],
    [{ name: "mcp__agents__trigger" }, "Manage automations"],
    [{ name: "mcp__agents__trigger_info" }, "Check automations"],
    // A chip from an earlier conversation keeps the name its call had.
    [{ name: "mcp__agents__create_trigger" }, "create trigger"],
    [{ name: "agent_browser_click" }, "Use the browser"],
    [{ name: "GITHUB_GET_A_COMMIT" }, "get a commit"],
    [{ name: "mcp__composio__LINEAR_CREATE_LINEAR_COMMENT" }, "create linear comment"],
    [{ name: "mcp__notes__query_database" }, "query database"],
    [{ name: "NotebookRead" }, "notebook read"],
    [{ name: "tool" }, "Use a tool"],
    [{ name: "mcp__agents__mcp_server", label: "removed MCP server linear" }, "removed MCP server linear"],
  ])("names %o as %s", (tool, label) => {
    expect(toolStepLabel(tool)).toBe(label);
  });

  it("names a command-titled chip as a command, not by its command line", () => {
    expect(toolStepLabel({ name: "ls -la /Users/sam/project", summary: "ls -la /Users/sam/project" })).toBe("Run a command");
  });

  it("says whose own account a step used, after what it did", () => {
    const whose = { person: "Ada", app: "Notion" };
    expect(toolStepLabel({ name: "mcp__own_apps__NOTION_SEARCH_NOTION_PAGE", whose })).toBe(`${toolStepLabel({ name: "mcp__own_apps__NOTION_SEARCH_NOTION_PAGE" })} · Using Ada's Notion`);
    expect(toolStepLabel({ name: "mcp__mail__read_inbox", whose: { person: "Ada", app: "mail" } })).toBe("read inbox · Using Ada's mail");
    expect(toolStepLabel({ name: "Bash", summary: "ls", whose })).toBe("Run a command · Using Ada's Notion");
  });

  it("keeps a line the server already wrote in words", () => {
    expect(toolStepLabel({ name: "Messaged @Ada" })).toBe("Messaged @Ada");
    expect(toolStepLabel({ name: "send failed — the sending bot no longer exists" })).toBe("send failed — the sending bot no longer exists");
  });
});
