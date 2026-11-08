import type { CloudAccountClient, CloudAccountState } from "./cloud-account.mjs";
export interface AccountEnrollMemory { accountId: string; dashboardUrl: string; workspaceId: string; at: number }
export declare function createAccountEnroll(options: {
  client(): Pick<CloudAccountClient, "enrollGrant">;
  localRequest(path: string, init: RequestInit): Promise<Pick<Response, "status" | "json">>;
  readMemory(): AccountEnrollMemory | null | Promise<AccountEnrollMemory | null>;
  writeMemory(value: AccountEnrollMemory): void | Promise<void>;
  log?(line: string): void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): { onState(state: CloudAccountState | null | undefined): void; close(): void };
