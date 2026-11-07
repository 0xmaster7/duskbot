import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { api } from "./api";
import type { Action, AppState, Bot, Group, Message } from "./store";

/** How many of the most recently active conversations load in the background once the open one has. */
export const PREFETCH_THREADS = 6;
const PREFETCH_DELAY_MS = 600;

type Owner = Bot | Group;
const needsPage = (owner: Owner | undefined) => Boolean(owner && (owner.transcriptLoaded === false || owner.transcriptStale));
const lastActive = (owner: Owner) => owner.tasks?.find((task) => task.threadId === owner.threadId)?.updatedAt ?? 0;

/** The conversations worth loading before anyone opens them: the most recently active ones without a current transcript. */
export function prefetchOrder(state: Pick<AppState, "bots" | "groups" | "selectedId">, limit = PREFETCH_THREADS): string[] {
  return [...state.bots.filter((bot) => !bot.hidden), ...state.groups]
    .filter((owner) => owner.id !== state.selectedId && needsPage(owner))
    .sort((a, b) => lastActive(b) - lastActive(a))
    .slice(0, limit)
    .map((owner) => owner.threadId);
}

/** Loads the newest page of the open conversation when it has no current transcript (none yet, or one cached from
 * before the last snapshot), then a few recent ones in the background, one at a time. */
export function useSelectedTranscript(state: AppState, dispatch: Dispatch<Action>, pageSize: number): () => void {
  const current = useRef(state);
  current.current = state;
  const epoch = useRef(0);
  const reads = useRef(new Map<string, { controller: AbortController; result: Promise<void> }>());
  const mounted = useRef(true);
  const invalidate = useCallback(() => {
    epoch.current += 1;
    for (const request of reads.current.values()) request.controller.abort();
    reads.current.clear();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; invalidate(); };
  }, [invalidate]);

  const read = useCallback((threadId: string): Promise<void> | null => {
    const owner = [...current.current.bots, ...current.current.groups].find((candidate) => candidate.threadId === threadId);
    if (!owner || !needsPage(owner)) return null;
    const startedEpoch = epoch.current;
    const generation = current.current.transcriptGeneration[threadId] ?? 0;
    const key = `${startedEpoch}:${threadId}`;
    let pending = reads.current.get(key);
    if (!pending) {
      const controller = new AbortController();
      const heldAtStart = owner.messages;
      const leafAtStart = "activeLeafId" in owner ? owner.activeLeafId : undefined;
      const result = api<{ messages: Message[]; hasMore?: boolean; activeLeafId?: string | null }>(
        `/api/threads/${threadId}/messages?limit=${pageSize}`, { signal: controller.signal, timeoutMs: 30_000 },
      ).then((page) => {
        if (!Array.isArray(page.messages)) throw new Error("Invalid conversation snapshot");
        if (mounted.current && epoch.current === startedEpoch) dispatch({
          type: "transcriptSnapshot", threadId, messages: page.messages, hasMore: Boolean(page.hasMore),
          activeLeafId: page.activeLeafId, generation, heldAtStart, leafAtStart,
        });
      }).finally(() => { if (reads.current.get(key)?.result === result) reads.current.delete(key); });
      pending = { controller, result };
      reads.current.set(key, pending);
    }
    return pending.result;
  }, [dispatch, pageSize]);

  const selected = state.bots.find((bot) => bot.id === state.selectedId) ?? state.groups.find((group) => group.id === state.selectedId);
  const threadId = selected?.threadId;
  const missing = needsPage(selected);
  useEffect(() => {
    if (!state.hydrated || state.activeView !== "chat" || !threadId || !missing) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = () => {
      const pending = read(threadId);
      if (!pending) return;
      void pending.then(() => {
        if (!stopped) retry = setTimeout(load, 0);
      }, (error) => {
        if (stopped) return;
        attempts += 1;
        if (attempts === 3) dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
        retry = setTimeout(load, Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5)));
      });
    };
    load();
    return () => { stopped = true; clearTimeout(retry); };
  }, [state.hydrated, state.activeView, state.selectedId, state.transcriptGeneration, threadId, missing, read, dispatch]);

  // the background reads wait for the open conversation; one that fails is left for when it is opened
  const queue = state.hydrated && !missing ? prefetchOrder(state).join("\n") : "";
  useEffect(() => {
    if (!queue) return;
    let stopped = false;
    const timer = setTimeout(async () => {
      for (const next of queue.split("\n")) {
        if (stopped) return;
        await read(next)?.catch(() => {});
      }
    }, PREFETCH_DELAY_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [queue, read]);
  return invalidate;
}
