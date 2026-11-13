// ⌘R and ⌘⇧R (Ctrl elsewhere) reload the window from the network, caught in before-input-event so nothing after it,
// the page, the menu or the macOS text system, can turn the press into something else.

/** Whether a before-input-event press is the reload chord on this platform. */
export function isReloadKey(input, platform = process.platform) {
  if (!input || input.type !== "keyDown" || input.alt || typeof input.key !== "string" || input.key.toLowerCase() !== "r") return false;
  return platform === "darwin" ? input.meta === true && !input.control : input.control === true && !input.meta;
}

/** Reload what the press landed in: its window's page, and the view itself when the press landed in a view on top. */
export function reloadFrom(contents, fromContents) {
  const win = fromContents(contents);
  const page = win && !win.isDestroyed() ? win.webContents : null;
  for (const target of new Set([page, contents])) if (target && !target.isDestroyed()) target.reloadIgnoringCache();
}

/** Watch every web contents the app makes; `fromContents` is BrowserWindow.fromWebContents. */
export function installReloadKeys({ app, fromContents, platform = process.platform }) {
  app.on("web-contents-created", (_event, contents) => contents.on("before-input-event", (event, input) => {
    if (!isReloadKey(input, platform)) return;
    event.preventDefault();
    if (!input.isAutoRepeat) reloadFrom(contents, fromContents);
  }));
}
