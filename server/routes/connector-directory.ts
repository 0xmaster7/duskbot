// GET /api/connectors/directory: every provider's apps merged into one list (server/connectors/provider.ts).
// providers come in precedence order: index.ts puts composio first, so an app it lists keeps its composio row and the
// vendors' own MCP servers fill the rest (or everything, when composio is not set up).
import { connectorDirectory, type ConnectorProvider } from "../connectors/provider.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createConnectorDirectoryRoutes({ providers }: { providers: () => readonly ConnectorProvider[] }): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path !== "/api/connectors/directory" || method !== "GET") return PASS;
    res.setHeader("cache-control", "private, no-store");
    return json(res, 200, await connectorDirectory(providers()));
  };
}
