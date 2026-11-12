const { contextBridge, ipcRenderer } = require("electron");

// This loading page has no app bridge, credentials or file access.
contextBridge.exposeInMainWorld("startupScreen", {
  close: () => ipcRenderer.send("startup-screen:close"),
  retry: () => ipcRenderer.send("startup-screen:retry"),
  quit: () => ipcRenderer.send("startup-screen:quit"),
});
