import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotReport, WorkspaceDetail, WorkspaceKind } from "../../../../shared/dashboard-protocol";
import { api, FIXTURE } from "../lib/api";
import { botMood, type BotMood } from "./mood";
import { useSession } from "./session";
import { usageMonth, type UsageMonth, type UsageSource } from "./usage-math";

export interface PlanWindow {
  provider: string;
  plan: string | null;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  workspaceName: string;
}

/** a bot on any workspace, with where it lives and what it is doing right now */
export interface BotRow { bot: BotReport; where: string; workspaceId: string; kind: WorkspaceKind; mood: BotMood }

interface Answer { detail: WorkspaceDetail | null; error: string | null }

export function useAccountUsage(): { month: UsageMonth | null; sources: UsageSource[]; loading: boolean; error: string | null; refresh(): void; plans: PlanWindow[]; bots: BotRow[] } {
  const { workspaces, workspacesError, workspace, detail, refresh: refreshSession } = useSession();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => { refreshSession(); setTick((t) => t + 1); }, [refreshSession]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const current = useRef({ workspace, detail });
  current.current = { workspace, detail };
  const workspaceIds = JSON.stringify(workspaces?.map((item) => item.id) ?? null);

  useEffect(() => {
    const ids = JSON.parse(workspaceIds) as string[] | null;
    if (!ids) return;
    let alive = true, pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      const selected = current.current;
      const results = await Promise.allSettled(ids.map((id) => selected.workspace?.id === id && selected.detail?.workspace.id === id ? Promise.resolve(selected.detail) : api.workspace(id, controller.signal)));
      pending = false;
      if (!alive) return;
      setAnswers((previous) => Object.fromEntries(ids.map((id, i) => {
        const result = results[i]!;
        return [id, result.status === "fulfilled" ? { detail: result.value, error: null } : { detail: previous[id]?.detail ?? null, error: result.reason instanceof Error ? result.reason.message : "Could not load workspace usage." }];
      })));
    };
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    const onVisibility = () => { void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [workspaceIds, tick]);

  const reports = (workspaces ?? []).map((item) => {
    const fetched = answers[item.id]?.detail ?? null;
    const picked = workspace?.id === item.id && detail?.workspace.id === item.id ? detail : null;
    const latest = picked && (!fetched || (picked.report?.at ?? 0) >= (fetched.report?.at ?? 0)) ? picked : fetched;
    return { workspace: item, detail: latest };
  });
  const reportKey = JSON.stringify(reports.map((item) => [item.workspace.id, item.workspace.name, item.detail !== null, item.detail?.report?.at, item.detail?.sectionAt.activity, item.detail?.sectionAt.bots, item.detail?.sectionAt.computers, item.workspace.freshness, item.detail?.sectionAt.plans]));
  const { sources, plans, bots } = useMemo(() => {
    const sources: UsageSource[] = [];
    const bots: BotRow[] = [];
    const windows = new Map<string, { at: number; window: PlanWindow }>();
    for (const item of reports) {
      if (!item.detail) continue;
      const { report, sectionAt } = item.detail;
      sources.push({ workspaceId: item.workspace.id, workspaceName: item.workspace.name, activity: report?.activity ?? null, bots: report?.bots ?? [] });
      for (const bot of report?.bots ?? []) bots.push({ bot, where: item.workspace.name, workspaceId: item.workspace.id, kind: item.workspace.kind, mood: botMood(bot, { freshness: item.workspace.freshness, computer: report?.computers?.computers.find((c) => c.botId === bot.id)?.state }) });
      for (const provider of report?.plans?.providers ?? []) for (const window of provider.windows) {
        const key = JSON.stringify([provider.id, window.label]);
        const at = sectionAt.plans ?? report?.at ?? 0;
        if (!windows.has(key) || at > windows.get(key)!.at) windows.set(key, { at, window: { provider: provider.name, plan: provider.plan, ...window, workspaceName: item.workspace.name } });
      }
    }
    return { bots, sources, plans: [...windows.values()].map((item) => item.window).sort((a, b) => b.usedPercent - a.usedPercent) };
  }, [reportKey]);
  const month = useMemo(() => usageMonth(sources, Date.now(), { split: FIXTURE ? "exact" : "estimate" }), [sources]);
  const loading = workspaces === null || reports.some((item) => !item.detail && !answers[item.workspace.id]);
  const error = !loading && reports.length > 0 && reports.every((item) => !item.detail) ? reports.map((item) => answers[item.workspace.id]?.error).find((message) => message !== null && message !== undefined) ?? null : null;
  return { month: sources.length || workspaces?.length === 0 ? month : null, sources, loading, error: workspacesError ?? error, refresh, plans, bots };
}
