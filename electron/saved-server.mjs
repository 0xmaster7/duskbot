// A server connected by hand, before the window goes there: the window goes only to a server that answers; one that
// doesn't (its name no longer resolves, nothing listens) is the person's choice: try again, remove it, or stay.

/** How long a server has to answer before it counts as not answering. */
export const SERVER_LOOK_MS = 3_000;
/** A linked vps answers through this app's own tunnel proxy, which opens a moment after launch: it is looked at quietly
 * this long before anyone is asked. */
export const TUNNEL_GRACE_MS = 15_000;
const LOOK_AGAIN_MS = 1_000;

/** The local address of a vps linked through the tunnel (vps-link.mjs): http://vps-<id>.localhost:<port>. */
export function tunnelOrigin(origin) {
  try { return /^vps-[^.]+\.localhost$/iu.test(new URL(origin).hostname); } catch { return false; }
}

/** Whether anything answers at `origin` (any HTTP status but a 5xx from a proxy in front of a stopped app). */
export async function serverAnswers(origin, fetchImpl, timeoutMs = SERVER_LOOK_MS) {
  try {
    const response = await fetchImpl(`${origin}/.well-known/duskbot/environment`, {
      cache: "no-store", redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" },
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Whether `origin` answers within `withinMs`, looked at again every second until then. */
export async function serverAnswersWithin(origin, fetchImpl, { withinMs, timeoutMs = SERVER_LOOK_MS, everyMs = LOOK_AGAIN_MS, now = Date.now, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const until = now() + withinMs, looks = Math.max(1, Math.floor(withinMs / everyMs) + 1);
  for (let look = 1; ; look++) {
    if (await serverAnswers(origin, fetchImpl, timeoutMs)) return true;
    // by the clock, and by count too, so a stopped clock never looks forever
    if (look >= looks || now() + everyMs > until) return false;
    await sleep(everyMs);
  }
}

/**
 * True when the window may go to `entry` now. A server that doesn't answer asks the person, in one dialog: Try again
 * (looks once more), Remove from list (`forget(entry.id)`, then false), or Cancel (false: the window stays where it is).
 * A vps reached through the tunnel is first given TUNNEL_GRACE_MS, since right after launch its proxy may not be open yet.
 * @param {{ id: string, name: string, origin: string }} entry
 * @param {{ fetch: typeof fetch, dialog: { showMessageBox(options: object): Promise<{ response: number }> }, forget: (id: string) => unknown, timeoutMs?: number, graceMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} deps
 */
export async function serverOpens(entry, { fetch: fetchImpl, dialog, forget, timeoutMs = SERVER_LOOK_MS, graceMs = TUNNEL_GRACE_MS, now, sleep }) {
  let first = tunnelOrigin(entry.origin);
  for (;;) {
    const answers = first ? await serverAnswersWithin(entry.origin, fetchImpl, { withinMs: graceMs, timeoutMs, now, sleep }) : await serverAnswers(entry.origin, fetchImpl, timeoutMs);
    first = false;
    if (answers) return true;
    const { response } = await dialog.showMessageBox({
      type: "warning", buttons: ["try again", "remove from list", "cancel"], defaultId: 0, cancelId: 2,
      message: `${entry.name} isn't answering`,
      detail: `nothing answers at ${new URL(entry.origin).host}. if that server is gone for good, remove it from your list. your bots elsewhere aren't affected.`,
    });
    if (response === 1) { await forget(entry.id); return false; }
    if (response !== 0) return false;
  }
}
