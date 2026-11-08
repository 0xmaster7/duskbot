import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { WorkspaceDetail, WorkspaceKind } from "../../shared/dashboard-protocol.ts";

export interface Account { id: string; email: string }
export interface WebSession { hash: string; accountId: string; expiresAt: number }
export interface StoredWorkspace {
  id: string;
  publicKey: string;
  ownerAccountId: string | null;
  claimHash: string | null;
  claimExpiresAt: number;
  name: string;
  kind: WorkspaceKind;
  version: string;
  connectedAt: number;
  lastReportAt: number | null;
  lastSeq: number;
  lastSeqAt: number;
  report: WorkspaceDetail["report"];
  sectionAt: WorkspaceDetail["sectionAt"];
}
export interface DashboardState { accounts: Account[]; sessions: WebSession[]; workspaces: StoredWorkspace[] }

export function createStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = `${dataDir}/state.json`;
  let state: DashboardState = { accounts: [], sessions: [], workspaces: [] };
  try {
    const loaded = JSON.parse(readFileSync(path, "utf8")) as DashboardState;
    if (!Array.isArray(loaded.accounts) || !Array.isArray(loaded.sessions) || !Array.isArray(loaded.workspaces)) throw new Error("Invalid dashboard state.");
    state = loaded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    writeFileSync(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
  return {
    state,
    changed() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 1000);
      timer.unref();
    },
    close() { if (timer) flush(); },
  };
}
