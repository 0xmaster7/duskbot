import type { DirectoryApp } from "../shared/connector-directory.ts";
import { REMOTE_MCP_APPS } from "./connectors/remote-mcp.ts";

const endpoint = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.search || url.hash ? null : `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
};

/** The catalog app a server's URL is, when the person connected it from Connect apps. */
export function remoteMcpAppFor(url: string | undefined): DirectoryApp | undefined {
  const key = url ? endpoint(url) : null;
  return key ? REMOTE_MCP_APPS.find((app) => app.url && endpoint(app.url) === key) : undefined;
}

/** The app's name for a person: its catalog label, else the server's own name. */
export function mcpServerLabel(name: string, url: string | undefined): string {
  return remoteMcpAppFor(url)?.label ?? name;
}
