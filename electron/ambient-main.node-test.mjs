import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installAmbient, isAmbientWindow } from "./ambient-main.mjs";

function fakes({ prefs = { island: true, dock: true }, activity = null } = {}) {
  const windows = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.destroyed = false; this.visible = false; this.ignore = null; this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), { send: (channel, payload) => this.sent.push([channel, payload]), setWindowOpenHandler() {}, isDestroyed: () => this.destroyed });
      this.events = new EventEmitter();
      windows.push(this);
    }
    setAlwaysOnTop(_on, level) { this.level = level; }
    setVisibleOnAllWorkspaces(_on, options) { this.workspaces = options; }
    setIgnoreMouseEvents(ignore, options) { this.ignore = { ignore, ...options }; }
    loadURL(url) { this.url = url; queueMicrotask(() => this.webContents.emit("did-finish-load")); return Promise.resolve(); }
    on(event, fn) { this.events.on(event, fn); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    destroy() { this.destroyed = true; this.events.emit("closed"); }
  }
  const handlers = new Map(), listeners = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => listeners.set(channel, fn) };
  const appPage = Object.assign(new EventEmitter(), { sent: [], send(channel, payload) { this.sent.push([channel, payload]); }, isDestroyed: () => false });
  const builtIn = { id: 1, internal: true, label: "Built-in Liquid Retina XDR Display", bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => [builtIn], getPrimaryDisplay: () => builtIn, getCursorScreenPoint: () => ({ x: 10, y: 10 }) });
  let saved = prefs;
  const opened = [], revealed = [];
  const ambient = installAmbient({
    ipcMain, BrowserWindow, platform: "darwin", page: () => appPage, origin: () => "http://127.0.0.1:5199",
    file: { read: () => saved, write: (value) => { saved = value; } },
    openChat: (botId, threadId) => opened.push([botId, threadId]), reveal: () => revealed.push(true), activity,
  });
  return { windows, handlers, listeners, appPage, screen, ambient, opened, revealed, saved: () => saved };
}

const surface = (windows, name) => windows.find((win) => !win.destroyed && win.options.webPreferences.additionalArguments.includes(`--omb-ambient=${name}`));
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the island and the dock open as click-through panels on the display, hidden over full-screen apps", async () => {
  const { windows, screen, ambient } = fakes();
  ambient.start(screen);
  await tick();
  const island = surface(windows, "island"), dock = surface(windows, "dock");
  assert.ok(island && dock);
  assert.equal(island.url, "http://127.0.0.1:5199/ambient.html?surface=island");
  assert.equal(island.options.type, "panel");
  assert.equal(island.bounds.y, 0);
  assert.deepEqual(island.ignore, { ignore: true, forward: true });
  assert.equal(island.workspaces.visibleOnFullScreen, false);
  assert.ok(island.visible && dock.visible);
  assert.ok(isAmbientWindow(island));
  const layout = island.sent.find(([channel]) => channel === "ambient:layout")[1];
  assert.equal(layout.collapsed.kind, "notch");
  // the page says the pointer reached its shape: clicks land there until it says otherwise
  island.webContents.emit("ipc-message", {}, "ambient:pointer", true);
  assert.deepEqual(island.ignore, { ignore: false });
  // hovering from bot to bot is the page's own business: never a new window
  const count = windows.length;
  for (let index = 0; index < 6; index++) dock.webContents.emit("ipc-message", {}, "ambient:pointer", index % 2 === 0);
  assert.equal(windows.length, count);
  island.webContents.emit("ipc-message", {}, "ambient:pointer", false);
  assert.deepEqual(island.ignore, { ignore: true, forward: true });
  ambient.close();
});

test("only the app's own page publishes the summary, and the surfaces' asks go back to it", async () => {
  const { windows, listeners, appPage, screen, ambient, opened, revealed } = fakes();
  ambient.start(screen);
  await tick();
  const island = surface(windows, "island");
  listeners.get("ambient:publish")({ sender: {} }, { bots: [{ id: "x", threadId: "t", name: "X" }] });
  assert.equal(island.sent.some(([channel]) => channel === "ambient:state"), false);
  listeners.get("ambient:publish")({ sender: appPage }, { bots: [{ id: "nova", threadId: "t1", name: "Nova", status: "working" }], labels: {}, lang: "en" });
  const state = island.sent.findLast(([channel]) => channel === "ambient:state")[1];
  assert.equal(state.bots[0].name, "Nova");
  island.webContents.emit("ipc-message", {}, "ambient:open", { botId: "nova", threadId: "t1" });
  assert.deepEqual(opened, [["nova", "t1"]]);
  island.webContents.emit("ipc-message", {}, "ambient:act", { kind: "reply", botId: "nova", threadId: "t1", text: "go" });
  island.webContents.emit("ipc-message", {}, "ambient:act", { kind: "wipe", botId: "nova", threadId: "t1" });
  island.webContents.emit("ipc-message", {}, "ambient:act", { kind: "new-bot" });
  assert.deepEqual(appPage.sent.filter(([channel]) => channel === "ambient:act").map(([, act]) => act.kind), ["reply", "new-bot"]);
  assert.equal(revealed.length, 1);
  ambient.close();
});

test("Settings turns a surface off and on, from the app's window only, and the dock keeps its order", async () => {
  const { windows, handlers, appPage, screen, ambient, saved } = fakes();
  ambient.start(screen);
  await tick();
  assert.throws(() => handlers.get("ambient:set")({ sender: {} }, { island: false }));
  const view = handlers.get("ambient:set")({ sender: appPage }, { island: false });
  assert.equal(view.island, false);
  assert.equal(surface(windows, "island"), undefined);
  assert.ok(surface(windows, "dock"));
  assert.equal(saved().island, false);
  surface(windows, "dock").webContents.emit("ipc-message", {}, "ambient:order", ["quill", "nova"]);
  assert.deepEqual(saved().order, ["quill", "nova"]);
  handlers.get("ambient:set")({ sender: appPage }, { dock: false });
  assert.equal(surface(windows, "dock"), undefined);
  assert.equal(await handlers.get("ambient:wanted")({ sender: appPage }), false);
  assert.deepEqual(appPage.sent.findLast(([channel]) => channel === "ambient:wanted"), ["ambient:wanted", false]);
  ambient.close();
});

test("both surfaces hear when to hold still, the newest word replayed to a page that loads later", async () => {
  const app = new EventEmitter(), powerMonitor = Object.assign(new EventEmitter(), { getSystemIdleState: () => "active" });
  let focused = true;
  const { windows, screen, ambient } = fakes({ activity: { app, powerMonitor, focused: () => focused } });
  ambient.start(screen);
  await tick();
  focused = false;
  app.emit("browser-window-blur");
  await tick();
  for (const name of ["island", "dock"]) {
    const sent = surface(windows, name).sent.filter(([channel]) => channel === "ambient:still").map(([, still]) => still);
    assert.deepEqual(sent.at(-1), true, name);
  }
  ambient.close();
  assert.equal(app.listenerCount("browser-window-blur"), 0);
});

test("someone who never chose gets the dock and the island", async () => {
  const { windows, ambient, screen } = fakes({ prefs: null });
  ambient.start(screen);
  await tick();
  assert.ok(surface(windows, "island") && surface(windows, "dock"));
  ambient.close();
});

test("what a surface has seen is saved, told to both surfaces, and still there after a restart", async () => {
  const first = fakes();
  first.ambient.start(first.screen);
  await tick();
  const dock = surface(first.windows, "dock"), island = surface(first.windows, "island");
  dock.webContents.emit("ipc-message", {}, "ambient:seen", ["echo:error:9", "../bad"]);
  assert.deepEqual(first.saved().seen, ["echo:error:9"]);
  assert.deepEqual(island.sent.findLast(([channel]) => channel === "ambient:seen")[1], ["echo:error:9"]);
  first.ambient.close();
  const again = fakes({ prefs: first.saved() });
  again.ambient.start(again.screen);
  await tick();
  surface(again.windows, "dock").webContents.emit("did-finish-load");
  assert.deepEqual(surface(again.windows, "dock").sent.findLast(([channel]) => channel === "ambient:seen")[1], ["echo:error:9"]);
  again.ambient.close();
});
