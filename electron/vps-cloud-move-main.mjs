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
 *   account(): { webHandoff?(options: { plan?: string, source?: string }): Promise<unknown>, refresh?(): Promise<unknown> } | null,
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
      if (!client?.webHandoff) throw new Error("Sign in to dusk cloud first.");
      const opened = await client.webHandoff({ plan: PLANS.has(plan) ? plan : "pro", source: "app_computer_move" });
      if (opened?.signedOut) throw Object.assign(new Error("Sign in to dusk cloud first."), { code: "signed_out" });
    },
    openHome: deps.openHome,
    ...(deps.lastInput ? { lastInput: deps.lastInput } : {}),
    track: deps.track,
    ...(deps.version ? { version: deps.version } : {}),
    onChange: () => deps.tell(move.view()),
    log: deps.log,
  });

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
  deps.ipcMain.handle("vps-cloud-move:view", (event) => { reading(event); return move.view(); });
  deps.ipcMain.handle("vps-cloud-move:start", async (event) => { const place = acting(event); return move.start(place.id); });
  deps.ipcMain.handle("vps-cloud-move:buy", async (event, plan) => {
    const place = acting(event);
    return move.start(place.id, { buying: true, plan: PLANS.has(plan) ? plan : "pro" });
  });
  deps.ipcMain.handle("vps-cloud-move:retry", async (event) => { reading(event); return move.retry(); });
  deps.ipcMain.handle("vps-cloud-move:cancel", (event) => { reading(event); return move.cancel(); });
  return move;
}
