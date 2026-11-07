import type { Message } from "@/state/store";
import { isStatusActivity } from "@/lib/activity-runs";
import { failedTurnCause } from "../../shared/failed-turn";

export function roomActivityVisible(message: Message, showToolCalls: boolean): boolean {
  const tool = message.tool;
  if (message.kind !== "activity" || !tool) return false;
  if (message.comm || message.threadRef || message.relay || message.dataResult || isStatusActivity(message)) return true;
  // a reply that never came shows in the card above the composer, not as a row
  if (failedTurnCause(tool.name) !== null) return tool.partial === true;
  return showToolCalls;
}
