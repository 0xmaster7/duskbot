// My Cloud's page focused in this app's window: the home hears it (POST /api/cloud/focus, a ping every 4 minutes), so the
// Admin's power policy keeps it up while someone is looking at it. A hint, never use: the home doesn't count it as
// activity, it never wakes a sleeping home (never sent then, and marked background for the edge), and it stops 30 minutes
// after the later of the focus starting and the person's last input, as the managed rails cap it.
import { BACKGROUND_HEADERS } from "./cloud-power.mjs";

export const FOCUS_PING_MS = 4 * 60_000;
export const FOCUS_CAP_MS = 30 * 60_000;
export const FOCUS_CHECK_MS = 30_000;

/** `origin()`: My Cloud's origin while the window shows its page and the Admin doesn't say it sleeps, else null.
 *  `focused()`: the window has focus. `lastInput()`: the person's last key or click in it. */
export function createCloudFocus({ origin, focused, lastInput = () => 0, fetch: fetchImpl, now = Date.now, pingMs = FOCUS_PING_MS, capMs = FOCUS_CAP_MS,
  checkMs = FOCUS_CHECK_MS, every = (work, ms) => { const timer = setInterval(work, ms); timer.unref?.(); return timer; }, stop = clearInterval, log = () => {} }) {
  let since = null, sentAt = null, sentTo = null, inFlight = false;
  async function ping(to) {
    inFlight = true; sentAt = now(); sentTo = to;
    try {
      const response = await fetchImpl(`${to}/api/cloud/focus`, { method: "POST", credentials: "include", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json", ...BACKGROUND_HEADERS }, body: "{}" });
      await response.body?.cancel?.().catch(() => {});
    } catch (error) { log(`cloud focus: ping failed (${error?.message ?? error})`); }
    finally { inFlight = false; }
  }
  /** Looks now: the window gained or lost focus, or the timer ticked. */
  function check() {
    const to = focused() ? origin() : null;
    if (!to) { since = null; return false; }
    const at = now();
    since ??= at;
    if (at - Math.max(since, lastInput() || 0) >= capMs) return false;
    if (inFlight || (sentTo === to && sentAt !== null && at - sentAt < pingMs)) return false;
    void ping(to);
    return true;
  }
  const timer = every(check, checkMs);
  return { check, close: () => stop(timer) };
}
