import { useEffect, useState, type Dispatch } from "react";
import { createTranscriptCache, indexedDbShelf, type TranscriptCache } from "./transcript-cache";
import type { Action, AppState } from "./store";

/** Keeps this device's transcript cache current with what the store holds, saves it on a person's own workspace, and
 * fills conversations the snapshot only previewed from it, for the newest page to confirm. */
export function useTranscriptCache(state: AppState, dispatch: Dispatch<Action>, cache?: TranscriptCache): void {
  const [own] = useState(() => cache ?? createTranscriptCache(indexedDbShelf()));
  const [shelfRead, setShelfRead] = useState(false);
  useEffect(() => {
    let alive = true;
    void own.loaded.then(() => { if (alive) setShelfRead(true); });
    return () => { alive = false; };
  }, [own]);

  const known = state.config !== null && state.config !== undefined;
  const shared = Boolean(state.config?.team);
  useEffect(() => {
    if (known) own.setEnabled(!shared);
  }, [own, known, shared]);
  useEffect(() => () => void own.flush(), [own]);

  useEffect(() => {
    for (const owner of [...state.bots, ...state.groups]) {
      if (owner.transcriptLoaded === false || owner.transcriptStale) continue;
      own.remember(owner.threadId, owner.messages, owner.hasMore, "activeLeafId" in owner ? owner.activeLeafId : null);
    }
  }, [own, state.bots, state.groups]);

  const selected = [...state.bots, ...state.groups].find((owner) => owner.id === state.selectedId)?.threadId;
  useEffect(() => {
    if (selected) own.touch(selected);
  }, [own, selected]);

  const usable = state.hydrated && known && !shared && shelfRead;
  const missing = usable
    ? [...state.bots, ...state.groups].filter((owner) => owner.transcriptLoaded === false && own.get(owner.threadId)).map((owner) => owner.threadId).join("\n")
    : "";
  useEffect(() => {
    if (!missing) return;
    dispatch({ type: "transcriptsCached", transcripts: missing.split("\n").flatMap((threadId) => own.get(threadId) ?? []) });
  }, [own, missing, dispatch]);
}
