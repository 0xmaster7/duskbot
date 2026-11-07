import { ASK_USER_TOOL } from "../../shared/ask-question.ts";
import type { ChatToolSession } from "./chat-mcp-tools.ts";
import { object, type ChatToolCall } from "./openai-chat-protocol.ts";

/** Hermes Agent's worker cap; Claude Code's is reported as 10. Each server's own queue takes more (16 for the harness proxies). */
export const MAX_PARALLEL_READS = 8;

interface BatchOptions<Result> {
  session: Pick<ChatToolSession, "parallel" | "view">;
  signal: AbortSignal;
  full(): boolean;
  covered(grant?: string): boolean;
  execute(call: ChatToolCall): Promise<Result>;
}

export async function* chatToolBatches<Result>(calls: readonly ChatToolCall[], options: BatchOptions<Result>): AsyncGenerator<Result[]> {
  const parallelRead = (call: ChatToolCall): boolean => {
    if (call.function.name === ASK_USER_TOOL) return false;
    try {
      const args = object(JSON.parse(call.function.arguments));
      if (!args || !options.session.parallel(call.function.name, args)) return false;
      const shown = options.session.view(call.function.name, args);
      return options.full() || !shown.ask || options.covered(shown.grant);
    } catch { return false; }
  };
  for (let index = 0; index < calls.length;) {
    options.signal.throwIfAborted();
    const batch = [calls[index++]!];
    if (parallelRead(batch[0]!)) {
      while (batch.length < MAX_PARALLEL_READS && index < calls.length && parallelRead(calls[index]!)) {
        batch.push(calls[index++]!);
      }
    }
    yield await Promise.all(batch.map(options.execute));
  }
}
