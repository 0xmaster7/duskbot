import { useCallback, useSyncExternalStore } from "react";

/** Past this size the ring shows from the first byte; smaller uploads show it only once they are slow. */
export const PROGRESS_SIZE_BYTES = 7 * 1024 * 1024;
export const PROGRESS_DELAY_MS = 2000;

export type UploadState = {
  size: number;
  startedAt: number;
  loaded: number;
  /** Null until the path reports bytes sent; some paths never do. */
  total: number | null;
};

const uploads = new Map<string, UploadState>();
const controllers = new Map<string, AbortController>();
const sources = new Map<string, File>();
const listeners = new Map<string, Set<() => void>>();

function changed(id: string): void {
  for (const listener of listeners.get(id) ?? []) listener();
}

export function showsUploadProgress(state: Pick<UploadState, "size" | "startedAt">, now: number): boolean {
  return state.size > PROGRESS_SIZE_BYTES || now - state.startedAt >= PROGRESS_DELAY_MS;
}

/** When a hidden ring is due, in ms from now; null once it shows. */
export function uploadProgressDueIn(state: Pick<UploadState, "size" | "startedAt">, now: number): number | null {
  return showsUploadProgress(state, now) ? null : PROGRESS_DELAY_MS - (now - state.startedAt);
}

/** Held below 1 while the bytes are sent but the server has not answered, so 100% means done. */
export function uploadFraction(state: Pick<UploadState, "loaded" | "total">): number | null {
  if (state.total === null || !(state.total > 0)) return null;
  return Math.min(0.99, Math.max(0, state.loaded / state.total));
}

/** The signal stops this upload when its tile is removed. */
export function startUpload(id: string, size: number, now = Date.now()): AbortSignal {
  controllers.get(id)?.abort();
  const controller = new AbortController();
  controllers.set(id, controller);
  uploads.set(id, { size, startedAt: now, loaded: 0, total: null });
  changed(id);
  return controller.signal;
}

export function reportUpload(id: string, loaded: number, total: number): void {
  const state = uploads.get(id);
  if (!state || !Number.isFinite(loaded) || !Number.isFinite(total)) return;
  if (state.total === total && state.loaded === loaded) return;
  uploads.set(id, { ...state, loaded: Math.max(0, loaded), total });
  changed(id);
}

export function endUpload(id: string): void {
  controllers.delete(id);
  if (uploads.delete(id)) changed(id);
}

export function cancelUpload(id: string): void {
  const controller = controllers.get(id);
  endUpload(id);
  controller?.abort();
  sources.delete(id);
}

export function uploadState(id: string): UploadState | undefined {
  return uploads.get(id);
}

/** The picked file stays in memory while its tile can still retry it. */
export function keepUploadSource(id: string, file: File): void {
  sources.set(id, file);
}

export function uploadSource(id: string): File | undefined {
  return sources.get(id);
}

export function dropUploadSource(id: string): void {
  sources.delete(id);
}

export function useUploadState(id: string): UploadState | undefined {
  const subscribe = useCallback((listener: () => void) => {
    const set = listeners.get(id) ?? new Set<() => void>();
    set.add(listener);
    listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(id);
    };
  }, [id]);
  const snapshot = useCallback(() => uploads.get(id), [id]);
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
