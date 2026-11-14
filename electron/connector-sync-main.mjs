// Main's side of connector sync (connector-sync.mjs): this computer, My Cloud while it is awake, and each server that
// says it is the person's alone, the same places the two-places suggestion reads (two-places-main.mjs), brought level
// every two minutes and soon after the window asks. Never a team's Cloud, nor a server others sign in to.
import { BACKGROUND_HEADERS } from "./cloud-power.mjs";
import { localPlace, remotePlace, syncConnectors } from "./connector-sync.mjs";
import { handSaved, serverRequests } from "./own-home-main.mjs";

const EVERY_MS = 2 * 60_000;

async function answer(response) {
  const text = await response.text().catch(() => "");
  try { return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null }; }
  catch { return { ok: response.ok, status: response.status, body: null }; }
}

/**
 * @param {{
 *   localRequest(route: string, init?: RequestInit): Promise<Response>,
 *   handoff(what: object): Promise<any>,
 *   fetch: typeof fetch,
 *   environments(): any[],
 *   cloud(): { origin: string | null, asleep: boolean, sleeps?: boolean },
 *   ownHome: { owns(place: any): boolean },
 *   log?(line: string): void,
 * }} deps
 */
export function installConnectorSyncMain({ localRequest, handoff, fetch: fetchImpl, environments, cloud, ownHome, log = () => {} }) {
  const places = () => {
    const out = [{ key: "local", kind: "local", label: "This computer", client: localPlace(localRequest, handoff) }];
    const mine = cloud();
    if (mine.origin && !mine.asleep) {
      const call = async (method, route, body) => answer(await fetchImpl(`${mine.origin}${route}`, {
        method, credentials: "include", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { accept: "application/json", origin: mine.origin, ...BACKGROUND_HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      out.push({ key: `cloud:${mine.origin}`, kind: mine.sleeps ? "sleeping-cloud" : "cloud", label: "My Cloud", client: remotePlace(call) });
    }
    for (const place of environments().filter((entry) => handSaved(entry) && ownHome.owns(entry))) {
      out.push({ key: `server:${place.origin}`, kind: "server", label: place.name, client: remotePlace(serverRequests(place, fetchImpl).call) });
    }
    return out;
  };
  let running = null, again = false;
  const pass = async () => {
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        const done = await syncConnectors(places(), { log });
        const changed = ["added", "removed", "signedOut", "moved"].filter((key) => done[key].length).map((key) => `${key} ${done[key].length}`);
        if (changed.length) log(`connector sync: ${changed.join(", ")}`);
        return done;
      } catch { return null; }
      finally { running = null; }
    })();
    const done = await running;
    if (again) { again = false; void pass(); }
    return done;
  };
  const timer = setInterval(() => void pass(), EVERY_MS);
  timer.unref?.();
  const first = setTimeout(() => void pass(), 20_000);
  first.unref?.();
  return { pass, close: () => { clearInterval(timer); clearTimeout(first); } };
}
