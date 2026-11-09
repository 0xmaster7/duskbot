// The island and the dock show the bots of whatever place the window shows (a linked server, a Cloud), so a click on one
// opens its chat in that place. It used to go out as a chat link for This computer, which left the server for This
// computer's empty workspace and its first run.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installAmbient } from "./ambient-main.mjs";
import { installDesktopNotifications } from "./desktop-notifications.mjs";

const COMPUTER = "http://127.0.0.1:5199", SERVER = "http://vps-example.localhost:53713";

function world(shownAt) {
  const log = [], at = { shown: shownAt };
  class BrowserWindow {
    constructor(options) {
      this.options = options; this.bounds = {}; this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), { send() {}, setWindowOpenHandler() {}, isDestroyed: () => this.destroyed });
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setIgnoreMouseEvents() {} on() {} showInactive() {}
    loadURL() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; } isVisible() { return true; } getBounds() { return this.bounds; } setBounds(bounds) { this.bounds = bounds; }
    destroy() { this.destroyed = true; }
  }
  const surfaces = [];
  const page = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isLoadingMainFrame: () => at.shown === null, getURL: () => `${at.shown}/`,
    send: (channel, payload) => log.push(channel === "desktop-notifications:open" ? `open ${payload.botId}/${payload.threadId}` : channel),
  });
  const listeners = new Map();
  const ipcMain = { handle() {}, on: (channel, fn) => listeners.set(channel, fn) };
  const notifications = installDesktopNotifications({
    ipcMain, Notification: class { static isSupported() { return true; } }, nativeImage: {}, fetch: async () => ({ ok: false }),
    window: () => ({ isDestroyed: () => false, webContents: page }), mayNotify: () => true,
    reveal: () => log.push("reveal"), openPlace: (origin) => log.push(`place ${origin}`),
  });
  const display = { id: 1, internal: true, label: "", bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => [display], getPrimaryDisplay: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }) });
  const ambient = installAmbient({
    ipcMain, platform: "darwin", page: () => page, origin: () => COMPUTER, file: { read: () => ({ island: true, dock: true }), write() {} },
    BrowserWindow: class extends BrowserWindow { constructor(options) { super(options); surfaces.push(this); } },
    openChat: (botId, threadId, origin) => origin && notifications.openAt(origin, { botId, threadId }), reveal: () => log.push("reveal"),
  });
  ambient.start(screen);
  const publish = () => listeners.get("ambient:publish")({ sender: page, senderFrame: { url: `${at.shown}/` } },
    { bots: [{ id: "nova", threadId: "t1", name: "Nova", status: "idle" }], labels: {}, lang: "en" });
  const click = () => surfaces[0].webContents.emit("ipc-message", {}, "ambient:open", { botId: "nova", threadId: "t1" });
  return { at, log, publish, click, arrived: () => notifications.arrived(), close: () => ambient.close() };
}

test("a bot on the linked server opens in that server's page, and nothing moves to This computer", () => {
  const w = world(SERVER);
  w.publish();
  w.click();
  assert.deepEqual(w.log.filter((line) => line !== "ambient:wanted"), ["reveal", "open nova/t1"]);
  assert.equal(w.log.some((line) => line.startsWith("place ")), false);
  w.close();
});

test("a click after the window moved elsewhere goes back to the bot's own place, then opens its chat there", () => {
  const w = world(SERVER);
  w.publish();
  w.at.shown = COMPUTER;
  w.click();
  assert.deepEqual(w.log.filter((line) => line.startsWith("place ") || line.startsWith("open ")), [`place ${SERVER}`]);
  w.at.shown = SERVER;
  w.arrived();
  assert.equal(w.log.at(-1), "open nova/t1");
  w.close();
});

test("This computer's own bots still open on This computer", () => {
  const w = world(COMPUTER);
  w.publish();
  w.click();
  assert.deepEqual(w.log.filter((line) => line !== "ambient:wanted"), ["reveal", "open nova/t1"]);
  w.close();
});
