export function activateExistingWindow(windows) {
  const alive = windows.filter((win) => win && !win.isDestroyed());
  if (alive.length === 0) return false;
  const target = alive.findLast((win) => win.isFocused()) ?? alive[0];
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  return true;
}

const alive = (win) => Boolean(win && !win.isDestroyed());

/** What a Dock click, a second launch or a link brings forward: the startup card while it stands in for the window, else
 * the main window, else another of the app's windows (focused first). Null: there is none, so one is made. */
export function windowToReveal({ splash = null, main = null, others = [] }) {
  if (alive(splash)) return splash;
  if (alive(main)) return main;
  const rest = others.filter(alive);
  return rest.findLast((win) => win.isFocused()) ?? rest[0] ?? null;
}

/** `win` in front where the person is: out of the Dock if minimized, unhidden after Hide (cmd+H), whole on a display
 * (`fit`), on macOS moved onto the current Space rather than the screen sliding off to another, then shown and focused
 * with the app active. A full-screen window keeps its own Space. */
export function bringToFront(win, { app = null, platform = process.platform, fit = null } = {}) {
  if (!alive(win)) return false;
  const mac = platform === "darwin";
  if (mac) app?.show?.();
  if (win.isMinimized()) win.restore();
  fit?.(win);
  const toThisSpace = mac && !win.isFullScreen?.() && !(win.isVisible() && win.isFocused()) && typeof win.setVisibleOnAllWorkspaces === "function";
  if (toThisSpace) win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
  win.show();
  if (toThisSpace) win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
  win.focus();
  if (mac) app?.focus?.({ steal: true });
  return true;
}
