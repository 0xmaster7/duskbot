// The app window's bots as main needs them for its keys: which are working (so ⌘Q can wait for a hold, quit-guard.mjs)
// and the menu's Stop commands, which the page carries out. Only this computer's own page reports busy bots: quitting
// never stops a turn on a server or Cloud the window shows.
import { createQuitGuard } from "./quit-guard.mjs";

const MAX_BOTS = 40;
const name = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 60) : "");

/**
 * @param {{ ipcMain: { on(channel: string, handler: (event: any, payload: unknown) => void): void },
 *   app: { on(event: string, handler: (...args: any[]) => void): void, quit(): void },
 *   window: () => any, isLocal: (contents: any) => boolean, platform?: string,
 *   timers?: { now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout } }} deps
 */
export function installDesktopBots({ ipcMain, app, window, isLocal, platform = process.platform, timers = {} }) {
  let busy = [];
  const page = () => { const win = window(); return win && !win.isDestroyed() ? win.webContents : null; };
  const busyNow = () => { const contents = page(); return contents && isLocal(contents) ? busy : []; };

  const guard = createQuitGuard({
    busy: busyNow,
    hint: (names) => page()?.send("desktop-bots:quit-hint", names),
    quit: () => app.quit(),
    platform,
    ...timers,
  });

  ipcMain.on("desktop-bots:busy", (event, raw) => {
    if (event.sender !== page() || !isLocal(event.sender)) return;
    busy = Array.isArray(raw) ? raw.slice(0, MAX_BOTS).map(name).filter(Boolean) : [];
  });
  app.on("web-contents-created", (_event, contents) => contents.on("before-input-event", (event, input) => guard.input(event, input)));
  app.on("browser-window-blur", () => guard.release());

  return {
    /** The menu's Quit item. */
    quit: (fromKeys) => guard.menu(fromKeys),
    /** The menu's Stop Bot and Stop All Bots: whichever place the window shows stops them. */
    stop: (all) => page()?.send("desktop-bots:stop", { all: all === true }),
    /** The names a quit would stop now. */
    busy: busyNow,
  };
}
