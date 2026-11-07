import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sampleDashboard } from "./fixtures";
import { overlayLive } from "./live";
import type { DashboardData } from "./types";

/** `?data=live` (or VITE_OMB_DASHBOARD_DATA=live) reads the local harness server through the /api proxy; anything it
 * cannot answer stays sample and is labelled so. */
export const wantsLive = () =>
  new URLSearchParams(window.location.search).get("data") === "live" || import.meta.env.VITE_OMB_DASHBOARD_DATA === "live";

interface Toast { id: number; text: string; undo?: () => void }

interface Store {
  data: DashboardData;
  ready: boolean;
  update(fn: (draft: DashboardData) => DashboardData): void;
  toasts: Toast[];
  toast(text: string, undo?: () => void): void;
  dismiss(id: number): void;
}

const Ctx = createContext<Store | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData>(() => sampleDashboard());
  const [ready, setReady] = useState(() => !wantsLive());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  useEffect(() => {
    if (ready) return;
    let live = true;
    void overlayLive(data).then((merged) => { if (live) { setData(merged); setReady(true); } }, () => live && setReady(true));
    return () => { live = false; };
  }, []);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback((text: string, undo?: () => void) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-2), { id, text, undo }]);
    setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);
  const update = useCallback((fn: (draft: DashboardData) => DashboardData) => setData((d) => fn(d)), []);

  const value = useMemo(() => ({ data, ready, update, toasts, toast, dismiss }), [data, ready, update, toasts, toast, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error("useStore outside DashboardProvider");
  return store;
}

export const useData = () => useStore().data;
