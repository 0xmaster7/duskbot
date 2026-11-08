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
};
export interface AccountGateBridge {
  state(): Promise<GateState>;
  signInStart(email: string): Promise<CloudSignInStart>;
  signInVerify(code: string): Promise<SignInVerify>;
  signInCancel(): Promise<unknown>;
  browser(provider: OAuthProvider): Promise<GateState>;
  cancel(): Promise<GateState>;
  onChange(cb: (state: GateState) => void): () => void;
}
