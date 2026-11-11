import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandView, WorkspaceSummary } from "../../../../shared/dashboard-protocol";
import { api } from "../lib/api";
import { toast } from "../lib/toast";
import { useCloud } from "./cloud";

export type AppFlowPhase = "waiting" | "sign-in" | "done" | "failed";
export interface AppFlow {
  key: string;
  action: "connect" | "disconnect";
  workspaceId: string;
  workspaceName: string;
  slug: string;
  label: string;
  phase: AppFlowPhase;
  url: string | null;
  message: string | null;
}

const COMMAND_WAIT_MS = 75_000;
const SIGN_IN_WAIT_MS = 5 * 60_000;
const COMMAND_POLL_MS = 1_000;
const SIGN_IN_POLL_MS = 3_000;
const NO_ANSWER = "your workspace did not answer. try again, or connect from the dusk bot app.";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const flowKey = (workspaceId: string, slug: string) => `${workspaceId}:${slug}`;

/** an empty tab opened inside the click, so the sign-in page can load there once the workspace hands back its link */
function blankTab(label: string): Window | null {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
    tab.document.title = `connecting ${label}`;
    tab.document.body.style.cssText = "font:15px system-ui;padding:32px;color:#555";
    tab.document.body.textContent = `asking your workspace for the ${label} sign-in...`;
  } catch {}
  return tab;
}

export function useAppCommands() {
  const { reloadConnections } = useCloud();
  const [flows, setFlows] = useState<Record<string, AppFlow>>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const update = useCallback((key: string, patch: Partial<AppFlow>) => {
    if (alive.current) setFlows((all) => all[key] ? { ...all, [key]: { ...all[key]!, ...patch } } : all);
  }, []);

  const settle = useCallback(async (workspaceId: string, id: string): Promise<CommandView | null> => {
    const until = Date.now() + COMMAND_WAIT_MS;
    while (alive.current && Date.now() < until) {
      await sleep(COMMAND_POLL_MS);
      const detail = await api.workspace(workspaceId).catch(() => null);
      const command = detail?.commands.find((c) => c.id === id);
      if (command && command.status !== "queued" && command.status !== "sent") return command;
    }
    return null;
  }, []);

  const run = useCallback(async (action: AppFlow["action"], ws: WorkspaceSummary, slug: string, label: string) => {
    const key = flowKey(ws.id, slug);
    const tab = action === "connect" ? blankTab(label) : null;
    const flow: AppFlow = { key, action, workspaceId: ws.id, workspaceName: ws.name, slug, label, phase: "waiting", url: null, message: null };
    setFlows((all) => ({ ...all, [key]: flow }));
    const failed = (message: string) => { tab?.close(); update(key, { phase: "failed", message }); toast(message, "bad"); };
    let id: string;
    try { id = (await api.command(ws.id, action === "connect" ? "app.connect" : "app.disconnect", slug)).command.id; }
    catch (e) { return failed((e as Error).message); }
    const command = await settle(ws.id, id);
    if (!alive.current) return;
    if (!command || command.status !== "done") return failed(command?.status === "failed" && command.message ? command.message : NO_ANSWER);
    if (action === "disconnect") {
      await reloadConnections();
      update(key, { phase: "done" });
      toast(`${label} is disconnected from ${ws.name}.`);
      return;
    }
    if (!command.url) return failed("this app did not return a sign-in page.");
    if (tab && !tab.closed) tab.location.href = command.url;
    update(key, { phase: "sign-in", url: command.url });
    const until = Date.now() + SIGN_IN_WAIT_MS;
    while (alive.current && Date.now() < until) {
      await sleep(SIGN_IN_POLL_MS);
      const answer = await reloadConnections();
      if (answer?.byWorkspace[ws.id]?.some((s) => s.toLowerCase() === slug)) {
        update(key, { phase: "done", url: null });
        toast(`${label} is connected on ${ws.name}.`);
        return;
      }
    }
    update(key, { phase: "failed", message: `${label} is not connected yet. finish signing in, then reload this page.` });
  }, [reloadConnections, settle, update]);

  const dismiss = useCallback((key: string) => setFlows((all) => { const { [key]: _, ...rest } = all; return rest; }), []);
  return {
    flows,
    connect: (ws: WorkspaceSummary, slug: string, label: string) => void run("connect", ws, slug, label),
    disconnect: (ws: WorkspaceSummary, slug: string, label: string) => void run("disconnect", ws, slug, label),
    dismiss,
  };
}
