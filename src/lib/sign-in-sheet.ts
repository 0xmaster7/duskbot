// The one sign-in sheet of the app's own page: every "sign in" opens it right where the person is (never Settings, never
// another page first), and what they were doing goes on once they are in (`then`).
import { useSyncExternalStore } from "react";

export interface SignInRequest { then?: () => void }
let open: SignInRequest | null = null;
const watchers = new Set<() => void>();
const tell = () => { for (const watch of Array.from(watchers)) watch(); };

export function openSignIn(request: SignInRequest = {}): void { open = request; tell(); }
export function closeSignIn(): void { open = null; tell(); }
export function useSignInOpen(): SignInRequest | null {
  return useSyncExternalStore((watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; }, () => open, () => null);
}
