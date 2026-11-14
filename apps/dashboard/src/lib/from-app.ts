/** the person came from the desktop app's account step (the account context redirect): after paying, the page sends
 *  them back to the app. Kept for the browser tab's session. */
export const FROM_APP_KEY = "dusk.fromApp";
/** the app's link after a purchase: dusk bot opens its cloud sheet, which picks the new cloud up */
export const APP_CLOUD_LINK = "duskbot://cloud";
export function markFromApp(query: URLSearchParams) {
  if (query.get("from") === "app" || (query.get("src") ?? "").startsWith("app_")) { try { sessionStorage.setItem(FROM_APP_KEY, "1"); } catch {} }
}
export function fromApp(): boolean { try { return sessionStorage.getItem(FROM_APP_KEY) === "1"; } catch { return false; } }

const SIGNED_IN_FOR = "dusk.appSignIn";
/** this tab signs in (or up) on the app's own sign-in page for `code`, so that sign-in's approval needs no second click */
export function markAppSignIn(code: string) { try { sessionStorage.setItem(SIGNED_IN_FOR, code); } catch {} }
/** whether this tab just signed in for `code` */
export function appSignInFor(code: string): boolean { try { return Boolean(code) && sessionStorage.getItem(SIGNED_IN_FOR) === code; } catch { return false; } }
export function forgetAppSignIn() { try { sessionStorage.removeItem(SIGNED_IN_FOR); } catch {} }
