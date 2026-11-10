// The agents catalog's send_message tool: one whole chat bubble from the bot, sent while it works. The harness shows the
// text from the engine's report of the call (server/harness/status-calls.ts), so the call itself only answers.
import type { ToolCallResult } from "./agents-call.ts";

export const SEND_MESSAGE_TOOL = "send_message";
export const SEND_MESSAGE_MAX = 8_000;

export function callSendMessageTool(): ToolCallResult {
  return { text: "Sent: it is in the chat now. Do not repeat it in your reply." };
}

export const SEND_MESSAGE_TOOL_DEFINITION = {
  name: SEND_MESSAGE_TOOL,
  description:
    "Send the person one chat message now, whole, as its own bubble: a short ack as work starts, what they will get, a milestone, or one part of the result. It shows at once; your final reply still goes as usual, so never repeat in it what you sent. Markdown text only.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string", minLength: 1, maxLength: SEND_MESSAGE_MAX },
    },
    required: ["text"],
  },
};
