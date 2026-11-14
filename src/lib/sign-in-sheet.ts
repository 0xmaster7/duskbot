// Every "sign in" of the app's page: the account step continues in the browser (src/lib/account-intent.ts) and the
// app waits in one calm sheet; `after` runs once the app is signed in (returning to the app is optional).
import { continueInBrowser } from "./account-intent";

let after: (() => void) | null = null;
export function openSignIn(request: { after?: () => void } = {}): void {
  after = request.after ?? null;
  void continueInBrowser({ kind: "signin" }).then((outcome) => { if (outcome === "opened") { const then = after; after = null; then?.(); } }, () => {});
}
/** the sign-in finished: what the person was doing goes on */
export function signedInNow(): void { const then = after; after = null; then?.(); }
export function closeSignIn(): void { after = null; }
