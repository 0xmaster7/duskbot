// set_status as a Codex dynamic tool. Codex keeps MCP tools behind its tool_search until the model looks them up, so the
// agents server's set_status was never in reach; a dynamic tool given at thread/start is sent with every request
// (codex-cli 0.167.0 app-server, `dynamicTools` with `deferLoading: false`), persists with the thread, and is answered
// here through `item/tool/call`. The harness reads the label from the call's item (server/harness/status-calls.ts).
import { STATUS_TOOL } from "../../shared/turn-progress.ts";
import { STATUS_TOOL_DEFINITION } from "./agents-status-tool.ts";
import { parseVersionTriple, versionAtLeast, type VersionTriple } from "./acp/version-probe.ts";

export const DYNAMIC_TOOLS_MIN_CODEX: VersionTriple = [0, 167, 0];

/** thread/start's dynamicTools for this Codex, or nothing on one too old to take them. */
export function codexStatusThreadParams(version: string | null): { dynamicTools?: unknown[] } {
  const parsed = version === null ? null : parseVersionTriple(version);
  if (parsed === null || !versionAtLeast(parsed, DYNAMIC_TOOLS_MIN_CODEX)) return {};
  return {
    dynamicTools: [{
      type: "function",
      name: STATUS_TOOL,
      description: STATUS_TOOL_DEFINITION.description,
      inputSchema: STATUS_TOOL_DEFINITION.inputSchema,
      deferLoading: false,
    }],
  };
}

/** The JSON-RPC reply to an `item/tool/call`: set_status only answers; any other dynamic tool is not ours. */
export function codexDynamicToolReply(params: { tool?: unknown; namespace?: unknown }): { result: unknown } | { error: { code: number; message: string } } {
  if (params.tool === STATUS_TOOL && !params.namespace) return { result: { contentItems: [{ type: "inputText", text: "ok" }], success: true } };
  return { error: { code: -32601, message: `Unknown dynamic tool: ${String(params.tool)}` } };
}
