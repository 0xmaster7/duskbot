import { failedTurnCause } from "../shared/failed-turn.ts";
import type { PlaceState } from "../shared/place-view.ts";
import type { WireMessage } from "../shared/wire.ts";

export const RESOLVE_SCAN = 50;

/** The place states a ready computer fixes: the cloud or VPS computer, and a computer that failed to start. */
export function computerFixesPlace(state: PlaceState): boolean {
  return state === "place-failed" || state === "vps" || (state.startsWith("cc-") && state !== "cc-needs-key" && state !== "cc-sign-in" && state !== "cc-tools-off" && state !== "cc-cannot");
}

/** The failed rows in a thread's tail that a ready computer resolves and nothing has resolved yet. */
export function computerFailuresToResolve(messages: readonly WireMessage[], scan = RESOLVE_SCAN): WireMessage[] {
  return messages.slice(-scan).filter((message) => {
    const tool = message.tool;
    return message.kind === "activity" && tool?.place !== undefined && tool.resolvedAt === undefined
      && failedTurnCause(tool.name) !== null && computerFixesPlace(tool.place.state);
  });
}
