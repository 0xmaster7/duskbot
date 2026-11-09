// The island's and the dock's whole bridge: the bots' summary and the layout in, a few named asks out. Nothing else of
// the app's bridge is here, so these pages can read and do no more than this.
const { contextBridge, ipcRenderer } = require("electron");

const surface = process.argv.find((arg) => arg.startsWith("--omb-ambient="))?.slice("--omb-ambient=".length) ?? "";
const listen = (channel) => (cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
const word = (value) => (typeof value === "string" ? value.slice(0, 128) : "");

contextBridge.exposeInMainWorld("ambient", {
  surface: surface === "island" || surface === "dock" ? surface : "",
  onState: listen("ambient:state"),
  onLayout: listen("ambient:layout"),
  /** True while the person is in another app or away: the surfaces hold still. */
  onStill: listen("ambient:still"),
  /** The pointer is on the shape (clicks land) or off it (clicks fall through to what is underneath). */
  pointer: (on) => ipcRenderer.send("ambient:pointer", on === true),
  /** A text field on the surface has focus: the panel keeps the keyboard while the pointer is away. */
  typing: (on) => ipcRenderer.send("ambient:typing", on === true),
  open: (botId, threadId) => ipcRenderer.send("ambient:open", { botId: word(botId), threadId: word(threadId) }),
  act: (act) => ipcRenderer.send("ambient:act", {
    kind: word(act?.kind), botId: word(act?.botId), threadId: word(act?.threadId), requestId: word(act?.requestId),
    ...(typeof act?.text === "string" ? { text: act.text.slice(0, 4000) } : {}),
  }),
  order: (ids) => ipcRenderer.send("ambient:order", Array.isArray(ids) ? ids.slice(0, 200).map(word) : []),
  /** Finished replies and failures the person has now seen, so they stop showing, here and after a restart. */
  seen: (keys) => ipcRenderer.send("ambient:seen", Array.isArray(keys) ? keys.slice(0, 50).map((key) => (typeof key === "string" ? key.slice(0, 160) : "")) : []),
  onSeen: listen("ambient:seen"),
  ready: () => ipcRenderer.send("ambient:ready"),
});
