import type { CloudAccountClient, CloudAccountState } from "./cloud-account.mjs";
export interface AccountGateState {
  required: boolean;
  blocked: boolean;
  status: CloudAccountState["status"];
  message?: string;
  enrollment?: CloudAccountState["enrollment"];
}
export declare function accountGateRequired(options: { env: Record<string, string | undefined>; packaged: boolean; remote: boolean; custom: boolean }): boolean;
export declare function gateBlocks(state: CloudAccountState | null | undefined): boolean;
export interface AccountGateBridge {
  state(): Promise<AccountGateState>;
  signInStart(email: string): ReturnType<CloudAccountClient["emailStart"]>;
  signInVerify(code: string): Promise<{ outcome: Awaited<ReturnType<CloudAccountClient["emailVerify"]>>["outcome"]; triesLeft?: number }>;
  signInCancel(): Promise<void>;
  browser(provider?: string): Promise<AccountGateState>;
  cancel(): Promise<AccountGateState>;
  onChange(callback: (state: AccountGateState) => void): () => void;
}
export declare function installAccountGate(options: {
  ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void };
  guard(channel: string, handler: (...args: any[]) => unknown): (...args: any[]) => unknown;
  client(): CloudAccountClient;
  required(): boolean;
  window(): { isDestroyed(): boolean; webContents: { send(channel: string, state: AccountGateState): void } } | null;
  restored?(): Promise<unknown>;
}): { changed(state: CloudAccountState): void };
