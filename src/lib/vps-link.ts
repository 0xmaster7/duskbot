// "Add your VPS" (electron/vps-link.mjs): the one command a person pastes on their server, the install's live steps, the AI
// sign-in sent from this computer, and the move. Only this computer's own page in the desktop app has the bridge.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export const VPS_STEP_IDS = ["check", "basics", "docker", "user", "node", "app", "engines", "service", "address", "desktop", "link"] as const;
export type VpsStepId = (typeof VPS_STEP_IDS)[number];
export type VpsStepStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export interface VpsLinkStep { id: VpsStepId; status: VpsStepStatus; log?: string }
export type VpsMoveStep = "backup" | "copy" | "verify" | "empty" | "done";
export interface VpsLinkMove {
  step: VpsMoveStep;
  status: "running" | "done" | "failed";
  chats?: { done: number; total: number };
  waitingFor?: string;
  error?: string;
  /** The copy failed and goes again by itself at this time (ms since epoch). */
  retryAt?: number;
  backupId?: string;
  /** Something did not arrive, so this computer kept its copy. */
  kept?: boolean;
}
export interface VpsServer { id: string; name: string; origin: string }
export interface VpsLinkView {
  stage: "idle" | "command" | "installing" | "linked" | "moving" | "moved" | "error";
  command: string | null;
  expiresAt: number | null;
  steps: VpsLinkStep[];
  server: VpsServer | null;
  error: string | null;
  move: VpsLinkMove | null;
  mode?: "relay" | "direct" | null;
}
export interface VpsEngine { instanceId: string; kind: "claude" | "codex"; name: string; signedIn: boolean }
export interface VpsSignIn {
  flowId: string | null;
  phase: "waiting" | "succeeded" | "failed" | "expired" | "cancelled";
  authorizationUrl: string | null;
  userCode?: string;
  needsCode: boolean;
  message?: string;
}
export interface VpsMovePreview {
  bots: Array<{ id: string; name: string; avatarUrl?: string }>;
  chats: number;
  messages: number | null;
  skills: number;
  memories: number | null;
  routines: number;
  apps: number | null;
  bytes: number | null;
}
export interface VpsBackup {
  id: string;
  at: number;
  bytes: number;
  summary: { bots: number; chats: number; skills: number; routines: number } | null;
  reason: "before-move" | "before-restore" | "manual" | "from-server";
}
/** `uninstall`: the line to paste on the server to take OpenMausBot off it (older apps leave it out). */
export interface VpsWhere { place: "mac" | "vps"; server: VpsServer | null; uninstall?: string }

export interface VpsLinkBridge {
  state(): Promise<VpsLinkView>;
  start(): Promise<VpsLinkView>;
  cancel(): Promise<VpsLinkView>;
  reset(): Promise<VpsLinkView>;
  engines(): Promise<VpsEngine[]>;
  signIn(instanceId: string): Promise<VpsSignIn>;
  signInStatus(instanceId: string, flowId: string): Promise<VpsSignIn>;
  signInCode(instanceId: string, flowId: string, code: string): Promise<{ ok: true }>;
  signInCancel(instanceId: string, flowId: string): Promise<{ ok: true }>;
  openUrl(url: string): Promise<void>;
  preview(): Promise<VpsMovePreview>;
  move(): Promise<VpsLinkView>;
  /** The move's next try, now. */
  retryMove(): Promise<VpsLinkView>;
  open(): Promise<void>;
  where(): Promise<VpsWhere>;
  backups(): Promise<VpsBackup[]>;
  backupNow(): Promise<{ id: string }>;
  restore(id: string): Promise<{ ok: true; restart: true }>;
  moveBack(): Promise<{ ok: true }>;
  forget(): Promise<VpsLinkView>;
  onChange(callback: (view: VpsLinkView) => void): () => void;
}

export function vpsLinkBridge(): VpsLinkBridge | undefined {
  if (typeof window === "undefined" || window.ogb?.remoteClient?.active) return undefined;
  if (window.ogb?.app && window.ogb.app.ownPage === false) return undefined;
  return window.ogb?.vpsLink;
}

/** False in a browser, on another place's page, and in desktop builds without the bridge. */
export const vpsLinkAvailable = (): boolean => Boolean(vpsLinkBridge());

export const EMPTY_VIEW: VpsLinkView = {
  stage: "idle", command: null, expiresAt: null, steps: VPS_STEP_IDS.map((id) => ({ id, status: "waiting" })), server: null, error: null, move: null,
};

/** Main's view of the link, kept fresh by its change events. */
export function useVpsLink(): { view: VpsLinkView; bridge: VpsLinkBridge | undefined; set(view: VpsLinkView): void } {
  const bridge = vpsLinkBridge();
  const [view, setView] = useState<VpsLinkView>(EMPTY_VIEW);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const unsubscribe = bridge.onChange((next) => { if (alive) setView(next); });
    void bridge.state().then((next) => { if (alive) setView(next); }, () => {});
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);
  const set = useCallback((next: VpsLinkView) => setView(next), []);
  return { view, bridge, set };
}

// whether the flow's sheet is open: one tiny store, so Settings and any other entry point open the same sheet
let open = false;
const watchers = new Set<() => void>();
const tell = () => { for (const watch of Array.from(watchers)) watch(); };
export function openAddVps(): void { open = true; tell(); }
export function closeAddVps(): void { open = false; tell(); }
export function useAddVpsOpen(): boolean {
  return useSyncExternalStore((watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; }, () => open, () => false);
}

/** Which of the four screens the view belongs on. `signedIn`: the person finished or skipped the AI sign-in. */
export function vpsStage(view: VpsLinkView, signedIn: boolean): 1 | 2 | 3 | 4 {
  if (view.stage === "moving" || view.stage === "moved") return 4;
  if (view.stage === "linked") return signedIn ? 4 : 3;
  if (view.stage === "installing") return 2;
  if (view.stage === "error" && view.server) return signedIn ? 4 : 3;
  if (view.stage === "error" && view.steps.some((step) => step.status !== "waiting")) return 2;
  return 1;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
