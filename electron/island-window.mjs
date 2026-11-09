// The notch island: a window across the top middle of its display, big enough for the panel it opens into, with the
// island itself drawn by its page around the notch (or as a floating pill on a display without one).
import { islandLayout } from "./ambient-geometry.mjs";
import { createAmbientWindow } from "./ambient-window.mjs";

export function createIslandWindow({ BrowserWindow, url, platform = process.platform, onMessage, log, trace = null }) {
  // above the menu bar, under the system's own alerts
  const overlay = createAmbientWindow({ BrowserWindow, surface: "island", url, level: "pop-up-menu", platform, onMessage, log, trace });
  return {
    ...overlay,
    /** Lays the island out on `display` and tells its page the shape. */
    layout(display, { size }) {
      const layout = islandLayout(display, { platform, size });
      overlay.place(layout.window);
      overlay.send("ambient:layout", { surface: "island", width: layout.window.width, height: layout.window.height, collapsed: layout.collapsed, tile: layout.tile, size: layout.size });
      return layout;
    },
  };
}
