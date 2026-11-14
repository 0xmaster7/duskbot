import type { CloudSignInStart } from "../../../electron/cloud-account.mjs";
import type { CloudSignInVerifyFailure } from "../../../electron/cloud-signin.mjs";
import type { OAuthProvider } from "../../../shared/account-api";

export type SignInVerify = { outcome: "signed-in" } | { outcome: "wrong-code"; triesLeft: number } | { outcome: Exclude<CloudSignInVerifyFailure, "wrong-code"> };
export type GateState = {
  required: boolean;
  blocked: boolean;
  status: "signed-out" | "connecting" | "connected" | "unavailable" | "reauth-required";
  message?: string;
  enrollment?: { userCode: string; expiresAt: number };
  /** Signing in at this provider in the browser, which comes back to the app signed in. */
  browser?: OAuthProvider;
  /** a magic link went to this address; opening it signs the app in */
  magic?: string;
  /** No system keyring: the sign-in is kept in a file only this computer's user account can read. */
  plainStorage?: true;
};
export interface AccountGateBridge {
  state(): Promise<GateState>;
  signInStart(email: string, options?: { recover: true }): Promise<CloudSignInStart>;
  /** Which providers the account service says sign in; absent on an older app build's bridge. */
  options?(): Promise<{ providers: OAuthProvider[]; recovery: boolean }>;
  signInVerify(code: string): Promise<SignInVerify>;
  signInCancel(): Promise<unknown>;
  browser(provider: OAuthProvider): Promise<GateState>;
  /** emails a magic link that signs in (or up) on the website, and this app with it; absent on an older app build's bridge */
  magicLink?(email: string): Promise<GateState>;
  cancel(): Promise<GateState>;
  reopen(): Promise<GateState>;
  onChange(cb: (state: GateState) => void): () => void;
}
