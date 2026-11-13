import { describe, expect, it } from "vitest";

import { appAccountGroups, chosenAppAccount, withChosenAppAccounts } from "./mcp-app-accounts.ts";
import { mcpServersPrompt } from "./mcp-apps-prompt.ts";
import { parseMcpServerMutation, parseStoredMcpServer, listMcpServers } from "./mcp-registry.ts";

const notion = { type: "http", url: "https://mcp.notion.com/mcp", headers: {} };
const linear = { type: "http", url: "https://mcp.linear.app/mcp", headers: {} };
const none = { defaults: {}, bots: {} };

describe("app accounts", () => {
  it("groups only apps connected more than once, in the order they were added", () => {
    const groups = appAccountGroups({ notion, linear, "notion-2": notion, shop: { command: "node" } });
    expect([...groups]).toEqual([["notion", ["notion", "notion-2"]]]);
  });

  it("mounts one account per app: the bot's pick, else the default, else the first", () => {
    const servers = { notion, "notion-2": notion, linear };
    expect(Object.keys(withChosenAppAccounts(servers, "nova", none))).toEqual(["notion", "linear"]);
    const defaults = { defaults: { "mcp-notion": "notion-2" }, bots: {} };
    expect(Object.keys(withChosenAppAccounts(servers, "nova", defaults))).toEqual(["notion-2", "linear"]);
    const picked = { defaults: { "mcp-notion": "notion-2" }, bots: { nova: { "mcp-notion": "notion" } } };
    expect(Object.keys(withChosenAppAccounts(servers, "nova", picked))).toEqual(["notion", "linear"]);
    expect(Object.keys(withChosenAppAccounts(servers, "quill", picked))).toEqual(["notion-2", "linear"]);
  });

  it("ignores a pick of an entry that is gone", () => {
    expect(chosenAppAccount("notion", ["notion", "notion-3"], "nova", { defaults: { "mcp-notion": "notion-2" }, bots: {} })).toBe("notion");
  });

  it("names the account a connected app's tools act as", () => {
    const text = mcpServersPrompt({ mounted: ["notion-2"], configured: { "notion-2": notion }, accountOf: (name) => (name === "notion-2" ? "work" : undefined) });
    expect(text).toContain("Notion (their work account, search, read and write pages and databases; its tools are mcp__notion-2__…)");
    expect(mcpServersPrompt({ mounted: ["notion"], configured: { notion }, accountOf: () => "Personal account" })).toContain("(their Personal account, search");
  });

  it("keeps an entry's account name through an edit, and lists it", () => {
    const added = parseStoredMcpServer("notion-2", { ...notion, account: " work " });
    expect(added.ok && "account" in added.server && added.server.account).toBe("work");
    const edited = parseMcpServerMutation("notion-2", { ...notion, enabled: true }, added.ok ? added.server : undefined);
    expect(edited.ok && "account" in edited.server && edited.server.account).toBe("work");
    expect(listMcpServers({ "notion-2": { ...notion, account: "work" } })[0]).toMatchObject({ account: "work" });
  });
});
