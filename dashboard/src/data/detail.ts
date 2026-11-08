import { useEffect, useState } from "react";
import type { WorkspaceDetail } from "../../../shared/dashboard-protocol";
import { api } from "../lib/api";
import { useSession } from "./session";

/** any workspace's newest report: the session's when it is the picked one, otherwise polled on its own */
export function useWorkspaceDetail(id: string | null): WorkspaceDetail | null {
  const { detail, workspace } = useSession();
  const picked = id !== null && workspace?.id === id;
  const [own, setOwn] = useState<WorkspaceDetail | null>(null);
  useEffect(() => {
    if (!id || picked) return;
    let alive = true;
    const load = () => { if (document.visibilityState === "visible") api.workspace(id).then((d) => { if (alive) setOwn(d); }, () => {}); };
    load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [id, picked]);
  if (!id) return null;
  return picked ? detail : own?.workspace.id === id ? own : null;
}
