// Main's side of the move straight from a VPS to My Cloud (vps-cloud-move.mjs): where its state lives, the page's channel,
// the checkout that opens signed in when there is no Cloud yet, and the way back through this computer.
//
// Security: a page names no server. Main moves only the server whose page is asking, and only when it is the active saved
// server this person connected by hand (`placeOf`); everything else is refused before the move is asked.
import { installVpsCloudMove } from "./vps-cloud-move.mjs";
import { handSaved } from "./own-home-main.mjs";

const PLANS = new Set(["plus", "pro"]);

/**
 * @param {{
 *   ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void },
 *   pageOrigin(event: unknown): string | null,
 *   localPage(event: unknown): boolean,
 *   environments(): any[],
 *   fetch: typeof fetch,
 *   cloud(): any,
 *   home(): { origin: string, grant(): Promise<{ origin: string, code: string }> } | null,
 *   cloudRead(route: string): Promise<Response>,
 *   file(name: string): { read(): unknown, write(value: unknown): void },
 *   account(): { webHandoff?(options: { plan?: string, source?: string }): Promise<unknown>, refresh?(): Promise<unknown>, state?(): any } | null,
 *   signIn?(): void,
 *   viaMac: { available(place: { origin: string }): boolean, start(place: any): Promise<unknown>, view(): any },
 *   openHome(): void,
 *   lastInput?(): number,
 *   track(name: string, props: Record<string, string | number | boolean>): void,
 *   tell(view: unknown): void,
 *   version?: string,
 *   log(line: string): void,
 * }} deps `pageOrigin(event)`: the active place's origin when the asking page is it. `localPage(event)`: this computer's
 * own page, which may only read the move. `tell`: every page that shows the move hears it changed.
 */
export function installVpsCloudMoveMain(deps) {
  // signed out when the person chose to buy: the sign-in opens right here, and the checkout follows it by itself
  let pendingPlan = null;
  // an account client that can't say who is signed in is asked by the checkout itself (webHandoff answers signedOut)
  const signedIn = () => { const client = deps.account(); if (client && typeof client.state !== "function") return true; const state = client?.state?.(); return Boolean(state?.account) && state?.status === "connected"; };
  const move = installVpsCloudMove({
    fetch: deps.fetch,
    environments: deps.environments,
    cloud: deps.cloud,
    home: deps.home,
    cloudRead: deps.cloudRead,
    journal: deps.file("vps-cloud-move.json"),
    choice: deps.file("vps-cloud-choice.json"),
    sendState: deps.file("vps-cloud-send.json"),
    viaMac: deps.viaMac,
    buy: async (plan) => {
      const client = deps.account();
      const chosen = PLANS.has(plan) ? plan : "pro";
      const askSignIn = () => {
        if (!deps.signIn) throw Object.assign(new Error("Sign in to dusk cloud first."), { code: "signed_out" });
        pendingPlan = chosen; deps.signIn(); deps.tell(viewNow());
      };
      if (!client?.webHandoff || !signedIn()) { askSignIn(); return; }
      const opened = await client.webHandoff({ plan: chosen, source: "app_computer_move" });
      if (opened?.signedOut) askSignIn();
    },
    openHome: deps.openHome,
    ...(deps.lastInput ? { lastInput: deps.lastInput } : {}),
    track: deps.track,
    ...(deps.version ? { version: deps.version } : {}),
    onChange: () => deps.tell(viewNow()),
    log: deps.log,
  });
  /** the move's view, and while a sign-in it asked for is open, that it waits on that */
  const viewNow = () => { const seen = move.view(); return pendingPlan && seen?.stage === "buying" ? { ...seen, signingIn: true } : seen; };
  /** the account changed: a purchase waiting on the sign-in goes on to its checkout, with no other step */
  move.signedInNow = async () => {
    if (!pendingPlan || !signedIn()) return;
    const plan = pendingPlan; pendingPlan = null;
    const chosen = move.chosen?.();
    try { if (chosen) await move.start(chosen.id, { buying: true, plan }); }
    catch (error) { deps.log(`vps to cloud: checkout after sign-in failed (${error?.message ?? error})`); }
    deps.tell(viewNow());
  };
  /** the person reopens the sign-in from the sheet */
  move.signInAgain = () => { if (pendingPlan && deps.signIn) deps.signIn(); };

  /** The saved server whose page asks, only while it is the one on screen. */
  const placeOf = (event) => {
    const origin = deps.pageOrigin(event);
    return origin ? deps.environments().find((entry) => handSaved(entry) && entry.origin === origin) ?? null : null;
  };
  const reading = (event) => {
    if (!placeOf(event) && !deps.localPage(event)) throw new Error("This is only available in this app's window.");
  };
  const acting = (event) => {
    const place = placeOf(event);
    if (!place) throw new Error("Open the server whose bots should move, then try again.");
    return place;
  };

  // asked from elsewhere (the rail's menu, the dashboard's link): the server's own page opens the sheet once, then never again
  let asked = null;
  move.ask = (id) => {
    const place = deps.environments().find((entry) => entry.id === id && handSaved(entry));
    if (!place) throw new Error("That server isn't in this app any more.");
    asked = { id: place.id, at: Date.now() };
    return place;
  };
  deps.ipcMain.handle("vps-cloud-move:asked", (event) => {
    const place = placeOf(event);
    const yes = Boolean(asked && place && place.id === asked.id && Date.now() - asked.at < 120_000);
    if (yes) asked = null;
    return yes;
  });
  deps.ipcMain.handle("vps-cloud-move:view", (event) => { reading(event); return viewNow(); });
  deps.ipcMain.handle("vps-cloud-move:start", async (event) => { const place = acting(event); return move.start(place.id); });
  deps.ipcMain.handle("vps-cloud-move:buy", async (event, plan) => {
    const place = acting(event);
    await move.start(place.id, { buying: true, plan: PLANS.has(plan) ? plan : "pro" });
    return viewNow();
  });
  deps.ipcMain.handle("vps-cloud-move:sign-in", (event) => { acting(event); move.signInAgain(); return viewNow(); });
  deps.ipcMain.handle("vps-cloud-move:retry", async (event) => { reading(event); return move.retry(); });
  deps.ipcMain.handle("vps-cloud-move:cancel", (event) => { reading(event); return move.cancel(); });
  return move;
}
