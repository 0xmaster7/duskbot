// This computer's page with no bots of its own, while the person's live somewhere else (the server they moved to, My
// Cloud, a team's Cloud, a server they linked): the page says where they are and opens that place, never a blank first
// run. Signed in, the place is also noted for the account (account-setup-store.mjs), so a fresh install of the same
// account says "You already set up OpenMausBot on …" and offers to connect.

const RANK = { moved: 0, cloud: 1, team: 2, server: 3 };
/** The id of My Cloud while it is home and saved as no place of its own. */
export const CLOUD_HOME_ID = "cloud";

/**
 * The places that hold the person's bots, the likeliest first: the server they moved to, My Cloud, a team's Cloud, then a
 * server saved by hand; one that went missing comes last.
 * @param {{ environments?: any[], moved?: { id: string, origin: string } | null, cloudOrigin?: string | null }} where
 * @returns {{ id: string, name: string, why: "moved" | "cloud" | "team" | "server" }[]}
 */
export function placesElsewhere({ environments = [], moved = null, cloudOrigin = null }) {
  const why = (entry) => (moved && (entry.id === moved.id || entry.origin === moved.origin) ? "moved"
    : entry.origin === cloudOrigin || entry.home || entry.cloud ? "cloud" : entry.team ? "team" : "server");
  const places = environments
    .filter((entry) => entry?.kind === "remote" && typeof entry.id === "string" && typeof entry.origin === "string" && typeof entry.name === "string" && entry.name.trim())
    .map((entry, index) => ({ id: entry.id, name: entry.name.trim().slice(0, 80), why: why(entry), index, missing: entry.missing === true }))
    .sort((a, b) => Number(a.missing) - Number(b.missing) || RANK[a.why] - RANK[b.why] || a.index - b.index)
    .map(({ id, name, why: reason }) => ({ id, name, why: reason }));
  if (cloudOrigin && !environments.some((entry) => entry?.origin === cloudOrigin)) places.unshift({ id: CLOUD_HOME_ID, name: "My Cloud", why: "cloud" });
  return places;
}

/** What the account remembers of a place: a team's Cloud comes with the sign-in itself, so it is not noted. */
const setupOf = (place, at) => (place.why === "team" ? null : { kind: place.why === "cloud" ? "cloud" : "server", name: place.name, at });

/**
 * @param {{ ipcMain: any, guard: (channel: string, handler: Function) => Function, places: () => ReturnType<typeof placesElsewhere>,
 *   account: () => { id?: string } | null, store: import("./account-setup-store.mjs").AccountSetupStore,
 *   open: (id: string) => unknown, connectCloud: () => unknown, now?: () => number, log?: (line: string) => void }} deps
 * `account()`: the signed-in account, null when there is none. `open(id)`: main's own switch to a saved place (or My Cloud
 * as home); `connectCloud()`: main's connect to My Cloud from the verified session, never a renderer's address.
 */
export function installBotsElsewhere({ ipcMain, guard, places, account, store, open, connectCloud, now = Date.now, log = () => {} }) {
  const signedIn = () => { const id = account()?.id; return typeof id === "string" && id ? id : null; };

  /** Notes the likeliest place for the signed-in account, once it is known here. */
  async function remember() {
    const id = signedIn(), setup = id ? places().map((place) => setupOf(place, now())).find(Boolean) : null;
    if (!setup) return;
    try { await store.remember(id, setup); } catch (error) { log(`bots elsewhere: ${error?.message ?? error}`); }
  }

  async function view() {
    const list = places();
    await remember();
    const id = signedIn();
    const known = id && !list.length ? await store.read(id).catch(() => null) : null;
    return { places: list, known: known ? { kind: known.kind, name: known.name } : null };
  }

  ipcMain.handle("elsewhere:state", guard("elsewhere:state", () => view()));
  ipcMain.handle("elsewhere:open", guard("elsewhere:open", (_event, id) => {
    if (typeof id !== "string" || !places().some((place) => place.id === id)) return false;
    void open(id);
    return true;
  }));
  // "server": the page opens its own Add your VPS sheet; a Cloud connects from the session main holds
  ipcMain.handle("elsewhere:connect", guard("elsewhere:connect", async () => {
    const id = signedIn(), known = id ? await store.read(id).catch(() => null) : null;
    if (!known) return null;
    if (known.kind === "cloud") void connectCloud();
    return known.kind;
  }));

  return { view, remember };
}
