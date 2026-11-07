// does electron's ignore-connections-limit lift chromium's six-per-host cap for a vps-<id>.localhost page?
//   SWITCH=localhost ./node_modules/.bin/electron scripts/testing/electron-connection-limit.cjs
//   ./node_modules/.bin/electron scripts/testing/electron-connection-limit.cjs           (no switch: three waves)
// a hidden window fires 18 requests at once at a loopback server that answers each after 500 ms.
const { app, BrowserWindow } = require("electron");
const http = require("node:http");

const host = "vps-abcdefghij.localhost";
if (process.env.SWITCH) app.commandLine.appendSwitch("ignore-connections-limit", process.env.SWITCH);
const server = http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body></body></html>"); return; }
  setTimeout(() => { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); }, 500);
});
server.listen(0, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false });
  await win.loadURL(`http://${host}:${server.address().port}/`);
  const ms = await win.webContents.executeJavaScript(`(async () => { const t = performance.now(); await Promise.all(Array.from({ length: 18 }, (_, i) => fetch("/x" + i, { cache: "no-store" }).then((r) => r.text()))); return Math.round(performance.now() - t); })()`);
  console.log(`switch=${process.env.SWITCH ?? "none"}: 18 parallel 500 ms requests took ${ms} ms`);
  app.quit();
});
