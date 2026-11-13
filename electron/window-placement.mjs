// Keeps the app's own windows whole on a display the person can see: as they are brought forward, and after a display
// goes away or changes size (window-state.cjs does the arithmetic).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fitBounds, sameBounds } = require("./window-state.cjs");

/** Every display's work area, the primary's first. */
export function workAreasOf(screen) {
  const primary = screen.getPrimaryDisplay();
  return [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)].map((display) => display.workArea);
}

/** `windows()`: the windows to keep on screen (never the island, dock or talk panel, which place themselves). */
export function createWindowPlacement({ screen, windows, delayMs = 300, schedule = setTimeout, cancel = clearTimeout, log = () => {} }) {
  /** Moves `win` back onto a display when any of it is off one; a maximized or full-screen window is the system's. */
  function fit(win) {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return false;
    const bounds = win.getBounds();
    const [minWidth = 0, minHeight = 0] = win.getMinimumSize?.() ?? [];
    const fitted = fitBounds(bounds, workAreasOf(screen), { width: minWidth, height: minHeight });
    if (!fitted || sameBounds(bounds, fitted)) return false;
    win.setBounds(fitted);
    log(`window kept on screen: ${JSON.stringify(bounds)} -> ${JSON.stringify(fitted)}`);
    return true;
  }
  let timer = null;
  // the system rearranges windows itself as a display changes: this runs once it has settled
  const refit = () => {
    if (timer) cancel(timer);
    timer = schedule(() => {
      timer = null;
      for (const win of windows()) fit(win);
    }, delayMs);
    timer?.unref?.();
  };
  function install() {
    screen.on("display-removed", refit);
    screen.on("display-added", refit);
    screen.on("display-metrics-changed", refit);
  }
  return { fit, refit, install };
}
