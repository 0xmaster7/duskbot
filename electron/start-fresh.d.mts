export const CONFIRM_PHRASE: "delete everything";
export function confirmed(typed: unknown): boolean;
export const DESKTOP_MARKER: string;
export function keptInDataDir(name: string): boolean;

export type StartFreshStepKind = "server" | "plan" | "account" | "ai" | "local";
export type StartFreshStatus = "pending" | "running" | "done" | "failed";
export interface StartFreshStep {
  id: string;
  kind: StartFreshStepKind;
  label: string;
  status: StartFreshStatus;
  clouds?: number;
  error?: string;
  code?: string;
  note?: "unlinked";
  /** a linked server: the line that also takes the dusk bot service off it */
  uninstall?: string;
}
export interface StartFreshView {
  phase: "idle" | "running" | "done" | "partial" | "restarting";
  steps: StartFreshStep[];
}
export interface StartFreshServer { id: string; name: string; origin: string; uninstall?: string }
export interface StartFresh {
  view(): StartFreshView;
  preview(): StartFreshView;
  run(typed: string): Promise<StartFreshView>;
  retry(): Promise<StartFreshView>;
  finish(): Promise<StartFreshView>;
}
export function createStartFresh(deps: {
  servers(): StartFreshServer[];
  wipeServer(server: StartFreshServer): Promise<"wiped" | "not-owner">;
  unlinkServer(server: StartFreshServer): Promise<void>;
  account(): { email: string; clouds: Array<{ id: string; name: string }> } | null;
  cancelPlan(cloudId: string): Promise<void>;
  deleteAccount(email: string): Promise<void>;
  signOut(): Promise<void>;
  removeAiKeys(): Promise<void>;
  markLocal(): void;
  relaunch(): void;
  changed?(view: StartFreshView): void;
  log?(line: string): void;
}): StartFresh;
export function applyPendingDesktopStartFresh(input: { userData: string; dataDir: string; fs?: typeof import("node:fs"); log?: (line: string) => void }): boolean;
export function markDesktopStartFresh(userData: string, fs?: typeof import("node:fs")): void;
