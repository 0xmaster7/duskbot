// The bot dock: a window against the right edge of the work area, as tall as the bots in it, wide enough for the card
// that slides out to the left of the bot under the pointer.
import { DOCK, dockLayout } from "./ambient-geometry.mjs";
import { createAmbientWindow } from "./ambient-window.mjs";

export function createDockWindow({ BrowserWindow, url, platform = process.platform, onMessage, log }) {
  const overlay = createAmbientWindow({ BrowserWindow, surface: "dock", url, level: "floating", platform, onMessage, log });
  return {
    ...overlay,
    layout(display, { count, order }) {
      const layout = dockLayout(display, { count });
      overlay.place(layout.window);
      overlay.send("ambient:layout", { surface: "dock", width: layout.window.width, height: layout.window.height, body: layout.body, top: layout.top, dock: DOCK, order });
      return layout;
    },
  };
}
