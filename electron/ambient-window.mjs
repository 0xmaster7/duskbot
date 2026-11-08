// One see-through overlay for the notch island or the bot dock: frameless, never in the Dock, Mission Control or the
// window list, on every Space but hidden over full-screen apps, and click-through except where its page says the
// pointer is on its shape (the page still hears the pointer moving, so it can tell).
import { fileURLToPath } from "node:url";

const overlays = new WeakSet();
export const isAmbientWindow = win => Boolean(win) && overlays.has(win);
const PRELOAD = fileURLToPath(new URL("./ambient-preload.cjs", import.meta.url));

/**
 * @param {{ BrowserWindow: any, surface: "island" | "dock", url: () => string | null, level: string,
 *   platform?: string, onMessage: (channel: string, payload: unknown) => void, log?: (line: string) => void }} deps
 */
export function createAmbientWindow({ BrowserWindow, surface, url, level, platform = process.platform, onMessage, log = () => {} }) {
  let win = null, loaded = false, interactive = false, bounds = null, page = null;
  const queued = new Map();
  const live = () => Boolean(win && !win.isDestroyed());

  function passThrough(on) {
    if (!live()) return;
    interactive = on;
    if (on) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  }

  function create(address) {
    const target = new BrowserWindow({
      ...(platform === "darwin" ? { type: "panel" } : {}),
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      // a click on the island's reply field has to reach it without bringing the whole app forward
      acceptFirstMouse: true,
      hiddenInMissionControl: true,
      enableLargerThanScreen: true,
      title: surface === "island" ? "MausBot island" : "MausBot dock",
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        preload: PRELOAD,
        additionalArguments: [`--omb-ambient=${surface}`],
      },
    });
    overlays.add(target);
    target.excludedFromShownWindowsMenu = true;
    target.setAlwaysOnTop(true, level);
    // electron/macOS: skipTransformProcessType keeps the Dock icon; full-screen apps keep their screen to themselves
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
    target.setIgnoreMouseEvents(true, { forward: true });
    target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    target.webContents.on("will-navigate", event => event.preventDefault());
    target.webContents.on("did-finish-load", () => {
      if (win !== target) return;
      loaded = true;
      for (const [channel, payload] of queued) target.webContents.send(channel, payload);
      if (!target.isVisible()) target.showInactive();
    });
    target.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) log(`ambient ${surface} page failed to load: ${description || code}`);
    });
    target.webContents.on("render-process-gone", (_event, details) => {
      log(`ambient ${surface} page gone: ${details?.reason ?? "unknown"}`);
      if (win === target) close();
    });
    target.webContents.on("ipc-message", (_event, channel, payload) => {
      if (win !== target || typeof channel !== "string" || !channel.startsWith("ambient:")) return;
      if (channel === "ambient:pointer") return passThrough(payload === true);
      try { onMessage(channel, payload); } catch (error) { log(`ambient ${surface} ${channel} failed: ${error?.message ?? error}`); }
    });
    target.on("closed", () => { if (win === target) { win = null; loaded = false; } });
    target.loadURL(address).catch(() => {});
    return target;
  }

  function close() {
    const target = win;
    win = null; loaded = false; interactive = false; page = null;
    if (target && !target.isDestroyed()) target.destroy();
  }

  return {
    surface,
    /** Puts the window where `next` says, making it on the first call once there is a page to load. */
    place(next) {
      bounds = next;
      const address = url();
      if (!address) return;
      if (live() && page !== address) close();
      if (!live()) {
        page = address;
        win = create(address);
        return;
      }
      const now = win.getBounds();
      if (now.x !== next.x || now.y !== next.y || now.width !== next.width || now.height !== next.height) win.setBounds(next);
    },
    /** Sends now if the page is up; the newest of each kind is replayed when it loads. */
    send(channel, payload) {
      queued.set(channel, payload);
      if (live() && loaded) win.webContents.send(channel, payload);
    },
    interactive: () => interactive,
    owns: contents => live() && contents === win.webContents,
    shown: () => live(),
    close,
  };
}
