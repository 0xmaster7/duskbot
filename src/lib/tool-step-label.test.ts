import { describe, expect, it } from "vitest";
import { toolStepLabel } from "./tool-step-label";

describe("toolStepLabel", () => {
  it.each([
    [{ name: "Bash", summary: "pnpm test" }, "run a command"],
    [{ name: "pwd", summary: "pwd" }, "run a command"],
    [{ name: "Read" }, "read a file"],
    [{ name: "WebSearch" }, "search the web"],
    [{ name: "mcp__dusk__computer_batch" }, "use the screen"],
    [{ name: "mcp__dusk__screenshot" }, "look at the screen"],
    [{ name: "mcp__claude_ai_Gmail__list_bots" }, "check the team"],
    [{ name: "mcp__agents__trigger" }, "manage automations"],
    [{ name: "mcp__agents__trigger_info" }, "check automations"],
    // A chip from an earlier conversation keeps the name its call had.
    [{ name: "mcp__agents__create_trigger" }, "Create trigger"],
    [{ name: "agent_browser_click" }, "use the browser"],
    [{ name: "GITHUB_GET_A_COMMIT" }, "Get a commit"],
    [{ name: "mcp__composio__LINEAR_CREATE_LINEAR_COMMENT" }, "Create linear comment"],
    [{ name: "mcp__notes__query_database" }, "Query database"],
    [{ name: "NotebookRead" }, "Notebook read"],
    [{ name: "tool" }, "use a tool"],
    [{ name: "mcp__agents__mcp_server", label: "removed MCP server linear" }, "removed MCP server linear"],
  ])("names %o as %s", (tool, label) => {
    expect(toolStepLabel(tool)).toBe(label);
  });

  it("names a command-titled chip as a command, not by its command line", () => {
    expect(toolStepLabel({ name: "ls -la /Users/sam/project", summary: "ls -la /Users/sam/project" })).toBe("run a command");
  });

  it("says whose own account a step used, after what it did", () => {
    const whose = { person: "Ada", app: "Notion" };
    expect(toolStepLabel({ name: "mcp__own_apps__NOTION_SEARCH_NOTION_PAGE", whose })).toBe(`${toolStepLabel({ name: "mcp__own_apps__NOTION_SEARCH_NOTION_PAGE" })} · using Ada's Notion`);
    expect(toolStepLabel({ name: "mcp__mail__read_inbox", whose: { person: "Ada", app: "mail" } })).toBe("Read inbox · using Ada's mail");
    expect(toolStepLabel({ name: "Bash", summary: "ls", whose })).toBe("run a command · using Ada's Notion");
  });

  it("keeps a line the server already wrote in words", () => {
    expect(toolStepLabel({ name: "Messaged @Ada" })).toBe("Messaged @Ada");
    expect(toolStepLabel({ name: "send failed — the sending bot no longer exists" })).toBe("send failed — the sending bot no longer exists");
  });
});
