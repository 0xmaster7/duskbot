// One welcome only: the person met dusk bot on this computer (its first run, which may have just bought the cloud), so
// their own dusk cloud opens straight on a working chat instead of a second "welcome to dusk cloud". As vps-link.mjs
// welcomeForServer does for a server, the cloud's onboarding record is marked done once, over this window's own signed-in
// session with the cloud; the hints the cloud already has are kept.
import { WELCOME_VERSION } from "./onboarding-record.mjs";

export const CLOUD_WELCOME_DONE = "cloud-welcome-done";
const ENDED = new Set([CLOUD_WELCOME_DONE, "cloud-setup-hidden"]);

/** The onboarding patch for the cloud, or null when its welcome already ended. `mine` is this computer's record. */
export function welcomeForCloud(mine, theirs, now) {
  const seen = Array.isArray(theirs?.hintsSeen) ? theirs.hintsSeen.filter((hint) => typeof hint === "string") : [];
  if (seen.some((hint) => ENDED.has(hint))) return null;
  const carried = Array.isArray(mine?.hintsSeen) ? mine.hintsSeen.filter((hint) => typeof hint === "string") : [];
  const hintsSeen = [...new Set([...seen, ...carried, CLOUD_WELCOME_DONE])];
  if (theirs?.completedAt) return { hintsSeen };
  return { completedAt: mine?.completedAt ?? now.toISOString(), version: mine?.completedAt ? mine.version ?? WELCOME_VERSION : WELCOME_VERSION, hintsSeen };
}

/**
 * Marks the cloud at `origin` welcomed, once. `fetch` carries this window's cookies (the page's own session with the
 * cloud); `local` reads this computer's config. Answers true when the record changed (the page shown may still be on
 * the welcome and is reloaded by the caller), false when there was nothing to do or the cloud didn't answer.
 */
export async function carryWelcomeToCloud({ origin, fetch, local, now = () => new Date(), log = () => {} }) {
  if (!origin) return false;
  const headers = { accept: "application/json", origin };
  try {
    const read = await fetch(`${origin}/api/config`, { credentials: "include", cache: "no-store", redirect: "error", headers, signal: AbortSignal.timeout(10_000) });
    if (!read.ok) return false;
    const theirs = (await read.json())?.onboarding;
    const mine = (await local())?.onboarding;
    const patch = welcomeForCloud(mine, theirs, now());
    if (!patch) return false;
    const wrote = await fetch(`${origin}/api/config`, { method: "PUT", credentials: "include", cache: "no-store", redirect: "error",
      headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ onboarding: patch }), signal: AbortSignal.timeout(10_000) });
    if (!wrote.ok) { log(`cloud welcome: not marked done (${wrote.status})`); return false; }
    return true;
  } catch (error) {
    log(`cloud welcome: not marked done (${error?.message ?? error})`);
    return false;
  }
}
