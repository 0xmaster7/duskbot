import { describe, expect, it } from "vitest";

import type { DirectoryApp } from "../../../shared/connector-directory";
import type { RemoteMcpListing } from "../mcp-draft";
import { freeServerName, remoteConnection, sameEndpoint } from "./use-remote-apps";

const vendor = (auth: "oauth" | "none"): DirectoryApp => ({
  id: "linear", source: "remote-mcp", label: "Linear", description: "", categories: [], domain: "linear.app", logo: null, url: "https://mcp.linear.app/mcp", auth,
});
const server = (patch: Partial<RemoteMcpListing>): RemoteMcpListing => ({ name: "linear", type: "http", url: "https://mcp.linear.app/mcp", headerKeys: [], enabled: true, ...patch });

describe("a vendor's own MCP server in Connect apps", () => {
  it("is the same server only at the same address", () => {
    expect(sameEndpoint("https://mcp.linear.app/mcp/", "https://mcp.linear.app/mcp")).toBe(true);
    expect(sameEndpoint("https://mcp.linear.app.evil.com/mcp", "https://mcp.linear.app/mcp")).toBe(false);
    expect(sameEndpoint("https://mcp.linear.app/mcp?key=1", "https://mcp.linear.app/mcp")).toBe(false);
    expect(sameEndpoint("not a url", "https://mcp.linear.app/mcp")).toBe(false);
  });

  it("is added under a free name", () => {
    expect(freeServerName("linear", [])).toBe("linear");
    expect(freeServerName("linear", [{ name: "linear" }, { name: "linear-2" }])).toBe("linear-3");
  });

  it("counts as connected only when on, and signed in when it needs a sign-in", () => {
    expect(remoteConnection(vendor("oauth"), undefined)).toBe("disconnected");
    expect(remoteConnection(vendor("oauth"), server({ auth: "needs-sign-in" }))).toBe("disconnected");
    expect(remoteConnection(vendor("oauth"), server({ auth: "signed-in", enabled: false }))).toBe("disconnected");
    expect(remoteConnection(vendor("oauth"), server({ auth: "signed-in" }))).toBe("connected");
    expect(remoteConnection(vendor("none"), server({}))).toBe("connected");
  });
});
