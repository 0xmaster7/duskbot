// The ambient surfaces' wiring in main: the notch island and the bot dock, the person's choices for them, and the one
// summary of the bots that the app's own page publishes (from the live stream it already has open, so the surfaces
// never ask a server anything). Their asks (open a chat, reply, allow) go back to that page, which does them.
import { pickDisplay } from "./ambient-geometry.mjs";
import { watchStill } from "./ambient-still.mjs";
import { applyPrefsChange, parseAct, parsePrefs, parseSnapshot, seenKeys } from "./ambient-state.mjs";
import { createDockWindow } from "./dock-window.mjs";
import { createIslandWindow } from "./island-window.mjs";

export { isAmbientWindow } from "./ambient-window.mjs";

/** How often the pointer's display is checked while the surfaces follow it across two displays or more. */
export const FOLLOW_MS = 1000;
const PAGE = "/ambient.html";

/**
 * @param {{ ipcMain: any, BrowserWindow: any, page: () => any, origin: () => string | null,
 *   file: { read(): unknown, write(value: unknown): void }, openChat: (botId: string, threadId: string) => void,
 *   reveal: () => void, activity?: { app: any, powerMonitor: any, focused: () => boolean } | null, platform?: string,
 *   log?: (line: string) => void }} deps `page()`: the app window's webContents, the only page whose summary counts and
 * the one that carries out the surfaces' asks. `activity`: what tells the surfaces to hold still (ambient-still.mjs).
 */
export function installAmbient({ ipcMain, BrowserWindow, page, origin, file, openChat, reveal, activity = null, platform = process.platform, log = () => {} }) {
  let prefs = null, snapshot = null, screen = null, started = false, follow = null, displayId = null, dockCount = -1, stillness = null;
  const saved = () => (prefs ??= (() => { try { return parsePrefs(file.read(), platform); } catch { return parsePrefs(null, platform); } })());
  const save = next => { prefs = next; try { file.write(next); } catch (error) { log(`ambient prefs not saved: ${error?.message ?? error}`); } };
  const address = surface => { const base = origin(); return base ? `${base}${PAGE}?surface=${surface}` : null; };
  const appPage = () => { const contents = page(); return contents && !contents.isDestroyed() ? contents : null; };

  const onMessage = surface => (channel, payload) => {
    if (channel === "ambient:ready") return tellAll();
    if (channel === "ambient:open") {
      if (typeof payload?.botId === "string" && typeof payload?.threadId === "string") openChat(payload.botId, payload.threadId);
      return;
    }
    if (channel === "ambient:act") {
      const act = parseAct(payload);
      if (!act) return;
      if (act.kind === "new-bot") reveal();
      appPage()?.send("ambient:act", act);
      return;
    }
    if (channel === "ambient:seen") {
      const keys = seenKeys(payload).slice(0, 50);
      if (!keys.length) return;
      const seen = seenKeys([...saved().seen.filter(key => !keys.includes(key)), ...keys]);
      save({ ...saved(), seen });
      island.send("ambient:seen", seen); dock.send("ambient:seen", seen);
      return;
    }
    if (channel === "ambient:order" && surface === "dock") {
      save(applyPrefsChange(saved(), { order: payload }));
      relayout();
    }
  };
  const island = createIslandWindow({ BrowserWindow, url: () => address("island"), platform, onMessage: onMessage("island"), log });
  const dock = createDockWindow({ BrowserWindow, url: () => address("dock"), platform, onMessage: onMessage("dock"), log });

  const display = () => {
    if (!screen) return null;
    return pickDisplay(screen.getAllDisplays(), saved().display, { primary: screen.getPrimaryDisplay(), cursor: saved().display === "active" ? screen.getCursorScreenPoint() : null });
  };

  function tellAll() {
    if (snapshot) { island.send("ambient:state", snapshot); dock.send("ambient:state", snapshot); }
    const seen = saved().seen;
    island.send("ambient:seen", seen); dock.send("ambient:seen", seen);
  }

  function relayout() {
    const on = saved();
    const target = started && origin() ? display() : null;
    displayId = target?.id ?? null;
    if (on.island && target) island.layout(target, { size: on.size }); else island.close();
    dockCount = snapshot?.bots.length ?? 0;
    if (on.dock && target) dock.layout(target, { count: dockCount, order: on.order }); else dock.close();
    tellAll();
    // the app's page summarises its bots only while a surface shows them
    appPage()?.send("ambient:wanted", wanted());
    followPointer();
  }

  // electron has no event for the pointer moving to another display: a cheap check, and only while it matters
  function followPointer() {
    const needed = started && screen && saved().display === "active" && (saved().island || saved().dock) && screen.getAllDisplays().length > 1;
    if (!needed) { clearInterval(follow); follow = null; return; }
    follow ??= setInterval(() => { if (display()?.id !== displayId) relayout(); }, FOLLOW_MS);
    follow.unref?.();
  }

  const wanted = () => started && (saved().island || saved().dock);
  const view = () => ({ available: true, platform, ...saved(), seen: undefined, displays: screen ? screen.getAllDisplays().map(entry => ({ id: entry.id, internal: entry.internal === true, label: String(entry.label ?? "") })) : [] });

  ipcMain.on("ambient:publish", (event, raw) => {
    if (event.sender !== appPage()) return;
    const next = parseSnapshot(raw);
    if (!next) return;
    snapshot = next;
    if (next.bots.length !== dockCount && saved().dock) relayout();
    else tellAll();
  });
  // Settings in whichever place the app's window shows; the preload asks a server's page for the person's click
  const fromApp = (channel, handler) => (event, ...args) => {
    if (event.sender !== appPage()) throw new Error(`${channel} is only available in this app's window`);
    return handler(...args);
  };
  ipcMain.handle("ambient:wanted", event => event.sender === appPage() && wanted());
  ipcMain.handle("ambient:prefs", fromApp("ambient:prefs", () => view()));
  ipcMain.handle("ambient:set", fromApp("ambient:set", change => {
    save(applyPrefsChange(saved(), change));
    relayout();
    return view();
  }));

  const changed = () => { try { relayout(); } catch (error) { log(`ambient relayout failed: ${error?.message ?? error}`); } };
  return {
    /** Once the app is ready: `screen` exists only then. */
    start(electronScreen) {
      if (started) return;
      started = true;
      screen = electronScreen;
      if (activity) {
        stillness = watchStill({ ...activity, onChange: (still) => { island.send("ambient:still", still); dock.send("ambient:still", still); } });
      }
      for (const event of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(event, changed);
      changed();
    },
    /** This app's server came up (the pages load from it) or its address changed. */
    refresh: changed,
    close() {
      started = false;
      clearInterval(follow); follow = null;
      stillness?.stop(); stillness = null;
      island.close(); dock.close();
    },
  };
}
