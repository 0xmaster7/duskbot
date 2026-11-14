import { useCallback, useEffect, useState } from "react";
import type { WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import { api } from "../lib/api";
import { useSession } from "./session";

export interface WorkspaceLoad { detail: WorkspaceDetail | null; error: string | null; retry(): void }

/** any workspace's newest report with how its last read went: the session's when it is the picked one, otherwise polled on its own */
export function useWorkspaceLoad(id: string | null): WorkspaceLoad {
  const { detail, detailError, workspace, refresh } = useSession();
  const picked = id !== null && workspace?.id === id;
  const [own, setOwn] = useState<WorkspaceDetail | null>(null);
  const [ownError, setOwnError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!id || picked) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      api.workspace(id).then((d) => { if (alive) { setOwn(d); setOwnError(null); } }, (e) => { if (alive && (e as Error).name !== "AbortError") setOwnError((e as Error).message || "could not load it."); });
    };
    load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [id, picked, tick]);
  const retryOwn = useCallback(() => setTick((n) => n + 1), []);
  if (!id) return { detail: null, error: null, retry: retryOwn };
  if (picked) return { detail, error: detail ? null : detailError, retry: refresh };
  return { detail: own?.workspace.id === id ? own : null, error: own?.workspace.id === id ? null : ownError, retry: retryOwn };
}

export function useWorkspaceDetail(id: string | null): WorkspaceDetail | null {
  return useWorkspaceLoad(id).detail;
}
