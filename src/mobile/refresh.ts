import { api, MESSAGE_PAGE_SIZE, type Action, type AppState } from "@/state/store";
import { snapshotArrays } from "@/state/api";

type Snapshot = Omit<Extract<Action, { type: "hydrate" }>, "type">;

/** Pull to refresh: the same snapshot the store hydrates from, applied without moving the person anywhere. The live
 * stream keeps the list current already; this answers a hand that wants to be sure. */
export async function refreshSnapshot(state: AppState, dispatch: (action: Action) => void): Promise<void> {
  const taskIdsAtStart = new Set([...state.bots, ...state.groups].flatMap((owner) => owner.tasks?.map((task) => task.threadId) ?? []));
  const answer = snapshotArrays(await api<Snapshot>(`/api/bots?messages=${MESSAGE_PAGE_SIZE}&selected=${encodeURIComponent(state.selectedId ?? "")}`), "bots");
  dispatch({
    type: "hydrate",
    bots: answer.bots,
    groups: answer.groups ?? [],
    sections: answer.sections ?? [],
    computerControl: answer.computerControl ?? {},
    botQueuedMessages: answer.botQueuedMessages,
    loadedThreads: answer.loadedThreads,
    preserveNavigation: true,
    navigationSince: state.transcriptGeneration,
    taskIdsAtStart,
  });
}
