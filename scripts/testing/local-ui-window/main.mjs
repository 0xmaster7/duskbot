// A hidden Electron window that shows this checkout's built UI at an older server's origin through electron/local-ui.mjs,
// then drives the core flows against that server. Started by scripts/testing/local-ui-old-server.mjs; prints one JSON line.
import { app, BrowserWindow } from "electron";
import { readFileSync, writeSync } from "node:fs";

import { bundleSource, createLocalUi } from "../../../electron/local-ui.mjs";

const { LUI_SERVER: server, LUI_UI_DIR: uiDir, LUI_BOT: botName, LUI_TEXT: text } = process.env;
// written at once: a killed window still leaves its last words
const say = (line) => writeSync(1, `${line}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.dock?.hide();
const failures = [], consoleErrors = [];
let deltaFrames = 0, liveFrames = 0;

async function until(what, check, timeoutMs = 30_000) {
  say(`waiting: ${what}`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await sleep(200);
  }
}

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { contextIsolation: true } });
  const page = (js) => win.webContents.executeJavaScript(js, true);
  win.webContents.on("console-message", (event) => { if (event.level === "error") consoleErrors.push(String(event.message).slice(0, 300)); });
  const ui = createLocalUi({ source: bundleSource(uiDir), origins: () => [server], log: (line) => say(line) });
  await ui.attach(win.webContents);
  win.webContents.debugger.on("message", (_event, method, params) => {
    if (method === "Network.responseReceived" && params.response.status >= 400) failures.push(`${params.response.status} ${new URL(params.response.url).pathname}`);
    // the live stream a reply arrives on: a WebSocket or an event stream, whichever this server speaks
    const frame = method === "Network.webSocketFrameReceived" ? params.response.payloadData : method === "Network.eventSourceMessageReceived" ? params.data : null;
    if (typeof frame === "string") { liveFrames += 1; if (/delta/.test(frame)) deltaFrames += 1; }
  });
  void win.webContents.debugger.sendCommand("Network.enable", {}).catch(() => {});
  await win.loadURL(server);

  const expected = /src="(\/assets\/[^"]+\.js)"/.exec(readFileSync(`${uiDir}/index.html`, "utf8"))?.[1];
  const shown = await page(`[...document.querySelectorAll("script[type=module]")].map((s) => new URL(s.src).pathname)`);
  const result = { origin: await page("location.origin"), bundle: shown.includes(expected) };

  await until("the bot in the sidebar", () => page(`[...document.querySelectorAll("button, a, [role=button], [role=link]")].some((el) => el.textContent.trim() === ${JSON.stringify(botName)} || el.textContent.includes(${JSON.stringify(botName)}))`));
  result.listedBots = true;
  await page(`(() => { const el = [...document.querySelectorAll("button, a, [role=button], [role=link]")].find((el) => el.textContent.includes(${JSON.stringify(botName)})); el.click(); return true; })()`);
  const composer = `textarea[aria-label=${JSON.stringify(`Message ${botName}`)}]`;
  await until("the chat to open", () => page(`Boolean(document.querySelector(${JSON.stringify(composer)}))`));
  result.openedChat = true;

  // a file, attached as the composer's picker would
  await page(`(() => {
    const input = document.querySelector(${JSON.stringify(composer)}).closest("form, [data-composer], div").ownerDocument.querySelector("input[type=file][multiple]");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["local ui upload fixture\\n"], "local-ui-note.txt", { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await until("the attachment chip", () => page(`document.body.innerText.includes("local-ui-note.txt")`));
  await page(`(() => {
    const box = document.querySelector(${JSON.stringify(composer)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(text)});
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    return true;
  })()`);
  await sleep(300);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  await until("the message in the chat", () => page(`document.body.innerText.includes(${JSON.stringify(text)})`));
  result.sent = true;
  // the reply streams in: some of it shows before all of it
  const reply = process.env.LUI_REPLY;
  const head = reply.slice(0, 12), whole = reply;
  let partial = false;
  await until("the reply in the chat", async () => {
    const body = await page("document.body.innerText");
    if (body.includes(head) && !body.includes(whole)) partial = true;
    return body.includes(whole);
  }, 90_000);
  result.replied = true;
  result.shownWhileStreaming = partial;
  result.liveFrames = liveFrames;
  result.deltaFrames = deltaFrames;
  result.streamed = partial || deltaFrames > 1;
  result.failures = failures;
  result.consoleErrors = consoleErrors.slice(0, 20);
  say(`LUI_RESULT ${JSON.stringify(result)}`);
  app.quit();
}

run().catch((error) => { say(`LUI_FAILED ${error?.stack ?? error} ${JSON.stringify({ failures, consoleErrors: consoleErrors.slice(0, 20) })}`); app.quit(); });
