// The agents catalog's set_status tool: the bot's own words for its status line. The harness reads the label from the
// engine's report of the call (server/harness/status-calls.ts), so the call itself only answers.
import { STATUS_LABEL_MAX, STATUS_TOOL } from "../../shared/turn-progress.ts";
import type { ToolCallResult } from "./agents-call.ts";

export function callStatusTool(): ToolCallResult {
  return { text: "ok" };
}

export const STATUS_TOOL_DEFINITION = {
  name: STATUS_TOOL,
  description:
    "Your status line while you work: what you are doing now, 2 to 6 words, a gerund phrase about this task (\"comparing keyboard reviews\"), no ellipsis. Call it when work with tools starts and at each phase change, in the same step as that phase's first real tool call; never alone when you could batch. Never mention it to the person.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", minLength: 1, maxLength: STATUS_LABEL_MAX * 2 },
    },
    required: ["status"],
  },
};
