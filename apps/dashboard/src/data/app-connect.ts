import { useSyncExternalStore } from "react";
import type { CommandKind, CommandView, ConnectorsAnswer, WorkspaceSummary } from "../../../../shared/dashboard-protocol";
import { api } from "../lib/api";
import { cheer } from "../lib/cheer";
import { toast } from "../lib/toast";
import { useCloud } from "./cloud";
import { dropPending, isAwake, wakeCloud, type WakeDeps } from "./cloud-wake";
import type { CloudDesktop } from "./contracts";

export type AppFlowPhase = "waking" | "waiting" | "sign-in" | "done" | "failed";
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

/** a command the workspace has not taken by now is not going to be: it is asleep, offline or not polling */
export const PICKUP_MS = 15_000;
/** taken but no link back by now: the sign-in is stuck on the workspace */
export const ANSWER_MS = 30_000;
const COMMAND_POLL_MS = 700;
const SIGN_IN_WAIT_MS = 5 * 60_000;
const SIGN_IN_POLL_MS = 3_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const flowKey = (workspaceId: string, slug: string) => `${workspaceId}:${slug}`;

/** the tab opened inside the click (a popup opened later is blocked): it says what is happening until the sign-in loads */
export interface SignInTab { say(text: string): void; go(url: string): void; close(): void }
function openTab(label: string): SignInTab | null {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  const write = (title: string, text: string) => {
    try {
      tab.document.title = title;
      tab.document.body.style.cssText = "font:15px/1.5 system-ui;padding:32px;max-width:560px;color:#1b1b1f;white-space:pre-line";
      tab.document.body.textContent = text;
    } catch {}
  };
  try { tab.opener = null; } catch {}
  write(`connecting ${label}`, "");
  return {
    say: (text) => { if (!tab.closed) write(`connecting ${label}`, text); },
    go: (url) => { if (!tab.closed) tab.location.href = url; },
    close: () => { try { tab.close(); } catch {} },
  };
}

export interface FlowDeps extends WakeDeps {
  command(id: string, kind: CommandKind, target: string): Promise<{ command: CommandView }>;
  connections(): Promise<ConnectorsAnswer | null>;
}
const browserDeps = (reload: () => Promise<ConnectorsAnswer | null>): FlowDeps => ({
  workspace: (id) => api.workspace(id), command: api.command, power: api.power, connections: reload, now: Date.now, sleep,
});

/** what to do next when a workspace never took the command, in its own terms */
export function notAnswering(ws: Pick<WorkspaceSummary, "name" | "kind">): string {
  return ws.kind === "vps"
    ? `${ws.name} is not answering right now. try again in a minute.`
    : `${ws.name} is not answering. open dusk bot on it, then try again.`;
}

/** queues the command and follows it: not taken in PICKUP_MS or not answered in ANSWER_MS ends it with what to do next */
export async function followCommand(ws: Pick<WorkspaceSummary, "id" | "name" | "kind">, kind: CommandKind, slug: string, deps: FlowDeps, onTaken?: () => void):
  Promise<{ ok: true; command: CommandView } | { ok: false; message: string }> {
  let id: string;
  try { id = (await deps.command(ws.id, kind, slug)).command.id; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
  const started = deps.now();
  let taken = false;
  while (true) {
    await deps.sleep(COMMAND_POLL_MS);
    const command = (await deps.workspace(ws.id).catch(() => null))?.commands.find((c) => c.id === id);
    if (command?.status === "done") return { ok: true, command };
    if (command && command.status !== "queued" && command.status !== "sent") {
      return { ok: false, message: command.status === "failed" && command.message ? command.message : notAnswering(ws) };
    }
    if (command?.status === "sent" && !taken) { taken = true; onTaken?.(); }
    const waited = deps.now() - started;
    if (!taken && waited >= PICKUP_MS) return { ok: false, message: notAnswering(ws) };
    if (waited >= ANSWER_MS) return { ok: false, message: `${ws.name} did not hand back a sign-in page. try again.` };
  }
}

const store = { flows: {} as Record<string, AppFlow>, listeners: new Set<() => void>() };
function setFlows(next: Record<string, AppFlow>) { store.flows = next; store.listeners.forEach((fn) => fn()); }
const running = (key: string) => store.flows[key]?.phase === "waking" || store.flows[key]?.phase === "waiting";
const patch = (key: string, change: Partial<AppFlow>) => { if (store.flows[key]) setFlows({ ...store.flows, [key]: { ...store.flows[key]!, ...change } }); };

/** one sign-in from the click to the connected app; it outlives the page, so leaving apps never strands its tab */
export async function runAppFlow(action: AppFlow["action"], ws: WorkspaceSummary, slug: string, label: string, deps: FlowDeps, tab: SignInTab | null) {
  const key = flowKey(ws.id, slug);
  if (running(key)) return tab?.close();
  setFlows({ ...store.flows, [key]: { key, action, workspaceId: ws.id, workspaceName: ws.name, slug, label, phase: "waiting", url: null, message: null } });
  const failed = (message: string) => {
    tab?.say(`${message}\n\nyou can close this tab.`);
    patch(key, { phase: "failed", message });
    toast(message, "bad");
  };
  tab?.say(`asking ${ws.name} for the ${label} sign-in.`);
  const answer = await followCommand(ws, action === "connect" ? "app.connect" : "app.disconnect", slug, deps,
    () => tab?.say(`getting the ${label} sign-in from ${ws.name}.`));
  if (!answer.ok) return failed(answer.message);
  if (action === "disconnect") {
    await deps.connections();
    patch(key, { phase: "done" });
    toast(`${label} is disconnected from ${ws.name}.`);
    return;
  }
  const url = answer.command.url;
  if (!url) return failed(`${label} did not return a sign-in page.`);
  tab?.go(url);
  patch(key, { phase: "sign-in", url });
  const until = deps.now() + SIGN_IN_WAIT_MS;
  while (deps.now() < until) {
    await deps.sleep(SIGN_IN_POLL_MS);
    const connected = await deps.connections().catch(() => null);
    if (connected?.byWorkspace[ws.id]?.some((s) => s.toLowerCase() === slug)) {
      patch(key, { phase: "done", url: null });
      cheer(`${label} is connected. your bots can use it now.`);
      return;
    }
  }
  patch(key, { phase: "failed", message: `${label} is not connected yet. finish signing in, then reload this page.` });
}

const dropFlow = (key: string) => { const { [key]: _, ...rest } = store.flows; setFlows(rest); };

/** a cloud we put to sleep wakes first, with no tab yet: a connect waits as a button in the corner pill, so its tab
 *  opens inside that click; a disconnect needs no tab and goes on its own */
export async function startAppFlow(action: AppFlow["action"], ws: WorkspaceSummary, slug: string, label: string, wake: CloudDesktop | undefined, deps: FlowDeps, openSignIn: () => SignInTab | null) {
  const key = flowKey(ws.id, slug);
  if (running(key)) return;
  if (!wake || isAwake(wake.id, deps.now())) {
    dropPending(key);
    return runAppFlow(action, ws, slug, label, deps, action === "connect" ? openSignIn() : null);
  }
  setFlows({ ...store.flows, [key]: { key, action, workspaceId: ws.id, workspaceName: ws.name, slug, label, phase: "waking", url: null, message: null } });
  const pending = action === "connect"
    ? { key, label: `connect ${label} now`, run: () => { dropFlow(key); void runAppFlow(action, ws, slug, label, deps, openSignIn()); }, cancel: () => dropFlow(key) }
    : undefined;
  const awake = await wakeCloud(wake, ws.name, { pending, deps });
  if (store.flows[key]?.phase !== "waking") return;
  if (!awake) {
    const message = `${ws.name} did not wake up. try again in a minute.`;
    patch(key, { phase: "failed", message });
    toast(message, "bad");
    return;
  }
  dropFlow(key);
  if (action === "disconnect") return runAppFlow(action, ws, slug, label, deps, null);
}

export function useAppCommands() {
  const { reloadConnections } = useCloud();
  const flows = useSyncExternalStore((fn) => { store.listeners.add(fn); return () => void store.listeners.delete(fn); }, () => store.flows, () => store.flows);
  const start = (action: AppFlow["action"]) => (ws: WorkspaceSummary, slug: string, label: string, wake?: CloudDesktop) => {
    void startAppFlow(action, ws, slug, label, wake, browserDeps(reloadConnections), () => openTab(label));
  };
  return {
    flows,
    /** `wake`: the dusk cloud we put to sleep that runs this workspace; it wakes first */
    connect: start("connect"),
    disconnect: start("disconnect"),
    dismiss: dropFlow,
  };
}

/** for tests */
export const resetAppFlows = () => setFlows({});
