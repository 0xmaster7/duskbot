import { join } from "node:path";
import { createJsonStore } from "./billing/json-store.ts";
import type { CommandView, WorkspaceDetail, WorkspaceKind } from "../../../shared/dashboard-protocol.ts";

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
/** a dashboard command kept until `purgeAt`, so a restart neither loses one in flight nor its result */
export interface StoredCommand extends CommandView { workspaceId: string; purgeAt: number }
export interface DashboardState { accounts: Account[]; sessions: WebSession[]; workspaces: StoredWorkspace[]; commands: StoredCommand[] }

export function createStore(dataDir: string) {
  return createJsonStore<DashboardState>(join(dataDir, "state.json"), () => ({ accounts: [], sessions: [], workspaces: [], commands: [] }),
    (value): value is DashboardState => !!value && typeof value === "object" && Array.isArray((value as DashboardState).accounts)
      && Array.isArray((value as DashboardState).sessions) && Array.isArray((value as DashboardState).workspaces));
}
