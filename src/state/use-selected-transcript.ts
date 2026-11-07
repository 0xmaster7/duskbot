import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { api } from "./api";
import type { Action, AppState, Message } from "./store";

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

  const selected = state.bots.find((bot) => bot.id === state.selectedId) ?? state.groups.find((group) => group.id === state.selectedId);
  const threadId = selected?.threadId;
  const loaded = selected?.transcriptLoaded;
  useEffect(() => {
    if (!state.hydrated || state.activeView !== "chat" || !threadId || loaded !== false) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = () => {
      const owner = [...current.current.bots, ...current.current.groups].find((candidate) => candidate.threadId === threadId);
      if (!owner || owner.transcriptLoaded !== false) return;
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
      void pending.result.then(() => {
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
  }, [state.hydrated, state.activeView, state.selectedId, state.transcriptGeneration, threadId, loaded, dispatch, pageSize]);
  return invalidate;
}
