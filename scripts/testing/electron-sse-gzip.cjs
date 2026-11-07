// does chromium's EventSource hand on each event of a gzipped stream (sync flush per event) as it arrives?
//   ./node_modules/.bin/electron scripts/testing/electron-sse-gzip.cjs
// a loopback server writes one event every 200 ms through one gzip context; a hidden window prints how long each took.
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const zlib = require("node:zlib");

let encoding = "";
const server = http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body></body></html>"); return; }
  encoding = String(req.headers["accept-encoding"] ?? "");
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "content-encoding": "gzip" });
  const zip = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
  zip.pipe(res);
  let n = 0;
  const timer = setInterval(() => {
    zip.write(`data: ${JSON.stringify({ n, sent: performance.timeOrigin + performance.now(), pad: "x".repeat(300) })}\n\n`);
    if (++n === 10) { clearInterval(timer); setTimeout(() => zip.end(), 100); }
  }, 200);
});
server.listen(0, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false });
  await win.loadURL(`http://vps-abcdefghij.localhost:${server.address().port}/`);
  const lags = await win.webContents.executeJavaScript(`new Promise((resolve) => { const lags = []; const es = new EventSource("/events"); es.onmessage = (e) => { const { sent } = JSON.parse(e.data); lags.push(+(performance.timeOrigin + performance.now() - sent).toFixed(2)); if (lags.length === 10) { es.close(); resolve(lags); } }; })`);
  console.log(`accept-encoding: ${encoding}`);
  console.log(`gzipped event stream, ms from write to EventSource message: ${lags.join(", ")}`);
  app.quit();
});
