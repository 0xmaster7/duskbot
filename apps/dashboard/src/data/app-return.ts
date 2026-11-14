// the desktop app's provider sign-in ends on /app-signed-in#code=...&state=... (shared APP_LANDING_PATH). the code is
// the app's one-time sign-in, so it lives in this module only and leaves the address bar before anything renders.
import { APP_AUTH_REDIRECT, APP_LANDING_PATH } from "../../../../shared/account-api.ts";
import { appPath } from "../lib/router";

const OPAQUE = /^[A-Za-z0-9_-]{16,256}$/;
let kept: string | null = null;

/** the app's deep link the fragment carries, or null when it isn't a well-formed one */
export function appReturnLink(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("code"), state = params.get("state");
  if (!code || !state || !OPAQUE.test(code) || !OPAQUE.test(state) || [...params.keys()].length !== 2) return null;
  return `${APP_AUTH_REDIRECT}?${new URLSearchParams({ code, state })}`;
}

export function stashAppReturn() {
  if (appPath(location.pathname) !== APP_LANDING_PATH || !location.hash) return;
  kept = appReturnLink(location.hash);
  history.replaceState(null, "", location.pathname + location.search);
}

export const appReturn = () => kept;
