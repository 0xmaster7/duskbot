// what stopped a reply, in one word the app turns into plain words: read from the flags the driver set and the
// classifiers retries and account switching already use, so a failed row and the retry logic always agree.
import type { FailedReplyReason } from "../shared/failed-turn.ts";
import { engineFailureKind } from "./drivers/engine-errors.ts";
import { classifyError } from "./drivers/retry.ts";

export function failedReplyReason(message: string, event: { setup?: boolean; claudeUpdate?: boolean; stalled?: boolean; limit?: string; limitResetsAt?: number }): FailedReplyReason | undefined {
  if (event.claudeUpdate) return undefined;
  const kind = engineFailureKind(message);
  const classified = classifyError({ text: message }).reason;
  if (kind === "credits") return "credits";
  if (event.limit || event.limitResetsAt || kind === "usage_limit" || classified === "quota") return "usage_limit";
  if (event.setup || classified === "auth") return "signed_out";
  if (kind === "overloaded" || classified === "overloaded") return "overloaded";
  if (kind === "rate_limit" || classified === "rate_limited") return "rate_limit";
  if (event.stalled || classified === "timeout") return "timeout";
  return undefined;
}
