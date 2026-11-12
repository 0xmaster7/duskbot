import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { bundleSource, createLocalUi, devSource, servedOrigins, uiPatterns, uiRoute } from "./local-ui.mjs";

const VPS = "http://vps-abc.localhost:51234";
const CLOUD = "https://me.dusk.cloud";
const html = [{ name: "Content-Type", value: "text/html; charset=utf-8" }];

test("only a saved place's origin is served, never this computer's own page", () => {
  assert.deepEqual(
    servedOrigins([CLOUD, `${VPS}/pair#code=x`, "http://127.0.0.1:8799", null, "file:///tmp/x", "not a url", CLOUD], ["http://127.0.0.1:8799", "http://127.0.0.1:5199"]),
    [VPS, CLOUD].sort(),
  );
});

test("a place's pages are paused once its server answered, its files before they leave, its API never", () => {
  const patterns = uiPatterns([CLOUD]);
  assert.deepEqual(patterns.find((pattern) => pattern.resourceType === "Document"), { urlPattern: `${CLOUD}/*`, resourceType: "Document", requestStage: "Response" });
  const types = new Set(patterns.map((pattern) => pattern.resourceType));
  for (const api of ["Fetch", "XHR", "EventSource", "WebSocket"]) assert.equal(types.has(api), false, api);
  // CDP's Fetch filter refuses a resource type it does not know, and then nothing at all is served
  for (const type of types) assert.ok(["Document", "Script", "Stylesheet", "Image", "Font", "Media", "Other"].includes(type), type);
  assert.equal(patterns.find((pattern) => pattern.resourceType === "Media").urlPattern, `${CLOUD}/assets/*`);
  assert.deepEqual(uiPatterns([]), []);
});

test("routing: pages, files, and what stays with the server", () => {
  const origins = [CLOUD, VPS];
  const page = (url, status = 200, headers = html) => uiRoute({ url, resourceType: "Document", responseStatusCode: status, responseHeaders: headers }, origins);
  assert.equal(page(`${CLOUD}/`), "page");
  assert.equal(page(`${CLOUD}/pair`), "page");
  assert.equal(page(`${VPS}/chat/abc?x=1`), "page");
  // the server's redirects (a frozen copy sends every page to /home) and errors stay its own
  assert.equal(page(`${CLOUD}/`, 302), "network");
  assert.equal(page(`${CLOUD}/`, 502), "network");
  assert.equal(uiRoute({ url: `${CLOUD}/`, resourceType: "Document", responseErrorReason: "ConnectionRefused" }, origins), "network");
  assert.equal(page(`${CLOUD}/download`, 200, [{ name: "content-type", value: "application/pdf" }]), "network");
  assert.equal(page(`${CLOUD}/api/files/x`), "network");
  assert.equal(page(`${CLOUD}/.well-known/duskbot/environment`), "network");
  assert.equal(page("https://elsewhere.example/"), "network");

  assert.equal(uiRoute({ url: `${CLOUD}/assets/index-abc.js`, resourceType: "Script" }, origins), "file");
  assert.equal(uiRoute({ url: `${VPS}/app-icon.svg`, resourceType: "Image" }, origins), "file");
  assert.equal(uiRoute({ url: `${CLOUD}/api/bots/1/avatar`, resourceType: "Image" }, origins), "network");
  assert.equal(uiRoute({ url: `${CLOUD}/apix/x.js`, resourceType: "Script" }, origins), "file");
  assert.equal(uiRoute({ url: "http://127.0.0.1:8799/assets/x.js", resourceType: "Script" }, origins), "network");
});

test("the bundle answers like the local server and never outside its folder", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "local-ui-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<p>app</p>");
  writeFileSync(path.join(dir, "rail.html"), "<p>rail</p>");
  writeFileSync(path.join(dir, "assets", "index-1.js"), "1");
  writeFileSync(path.join(dir, "app-icon.svg"), "<svg/>");
  writeFileSync(path.join(path.dirname(dir), "outside.txt"), "secret");
  const source = bundleSource(dir);

  const index = await source.page(`${CLOUD}/chat/1`);
  assert.equal(String(index.body), "<p>app</p>");
  assert.equal(index.headers["content-type"], "text/html");
  assert.equal(index.headers["x-frame-options"], "DENY");
  assert.equal(index.headers["cache-control"], "no-cache");
  assert.equal(String((await source.page(`${CLOUD}/rail`)).body), "<p>rail</p>");

  const script = await source.file(`${CLOUD}/assets/index-1.js?v=2`);
  assert.equal(script.headers["content-type"], "text/javascript");
  assert.match(script.headers["cache-control"], /immutable/);
  assert.equal((await source.file(`${CLOUD}/app-icon.svg`)).headers["content-type"], "image/svg+xml");
  // a file only an older server's own page names is that server's to answer
  assert.equal(await source.file(`${CLOUD}/assets/index-OLD.js`), null);
  assert.equal(await source.file(`${CLOUD}/assets`), null);
  assert.equal(await source.file(`${CLOUD}/%2e%2e/outside.txt`), null);
  assert.equal(await source.file(`${CLOUD}/..%2Foutside.txt`), null);
});

test("the dev source passes Vite's answer through and leaves a missing file to the server", async () => {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push([url, init.headers.accept]);
    if (url.endsWith("/missing.js")) return new Response("nope", { status: 404 });
    if (url.includes("/@vite/client")) return new Response("export {}", { headers: { "content-type": "text/javascript", "content-encoding": "gzip" } });
    return new Response("<html></html>", { headers: { "content-type": "text/html" } });
  };
  const source = devSource("http://127.0.0.1:5199/", { fetch });
  const client = await source.file(`${VPS}/@vite/client?t=1`);
  assert.equal(String(client.body), "export {}");
  assert.equal(client.headers["content-encoding"], undefined);
  assert.equal(await source.file(`${VPS}/missing.js`), null);
  const page = await source.page(`${VPS}/chat/1`);
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.deepEqual(asked.map(([url]) => url), ["http://127.0.0.1:5199/@vite/client?t=1", "http://127.0.0.1:5199/missing.js", "http://127.0.0.1:5199/chat/1"]);
});

function fakeWindow() {
  const sent = [];
  const debuggerApi = Object.assign(new EventEmitter(), {
    attached: false,
    isAttached() { return this.attached; },
    attach() { this.attached = true; },
    async sendCommand(method, params) { sent.push([method, params]); return {}; },
  });
  const contents = Object.assign(new EventEmitter(), { debugger: debuggerApi, isDestroyed: () => false });
  return { contents, sent };
}

test("the window: patterns follow the places, a paused request gets one answer", async () => {
  const { contents, sent } = fakeWindow();
  let places = [];
  const source = { page: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("new") }), file: async (url) => (url.endsWith("/new.js") ? { status: 200, headers: {}, body: Buffer.from("js") } : null) };
  const ui = createLocalUi({ source, origins: () => places });
  await ui.attach(contents);
  // only This Mac: nothing is intercepted
  assert.deepEqual(sent.map(([method]) => method), ["Fetch.disable"]);
  places = [CLOUD];
  await ui.refresh();
  await ui.refresh();
  assert.deepEqual(sent.map(([method]) => method), ["Fetch.disable", "Fetch.enable"]);

  const answer = async (params) => {
    sent.length = 0;
    contents.debugger.emit("message", {}, "Fetch.requestPaused", params);
    await new Promise((resolve) => setImmediate(resolve));
    return sent;
  };
  const [[method, fulfilled]] = await answer({ requestId: "1", resourceType: "Document", responseStatusCode: 200, responseHeaders: html, request: { url: `${CLOUD}/` } });
  assert.equal(method, "Fetch.fulfillRequest");
  assert.equal(Buffer.from(fulfilled.body, "base64").toString(), "new");
  assert.deepEqual((await answer({ requestId: "2", resourceType: "Script", request: { url: `${CLOUD}/assets/old.js` } })).map(([m]) => m), ["Fetch.continueRequest"]);
  assert.deepEqual((await answer({ requestId: "3", resourceType: "Script", request: { url: `${CLOUD}/new.js` } })).map(([m]) => m), ["Fetch.fulfillRequest"]);
  assert.deepEqual((await answer({ requestId: "4", resourceType: "Image", request: { url: `${CLOUD}/api/x` } })).map(([m]) => m), ["Fetch.continueRequest"]);
});

test("the window: a source that fails leaves the server's own answer", async () => {
  const { contents, sent } = fakeWindow();
  const ui = createLocalUi({ source: { page: async () => { throw new Error("disk"); }, file: async () => null }, origins: () => [CLOUD] });
  await ui.attach(contents);
  sent.length = 0;
  contents.debugger.emit("message", {}, "Fetch.requestPaused", { requestId: "1", resourceType: "Document", responseStatusCode: 200, responseHeaders: html, request: { url: `${CLOUD}/` } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, [["Fetch.continueRequest", { requestId: "1" }]]);
});

test("the window: a debugger it cannot have leaves every page to its server", async () => {
  const { contents, sent } = fakeWindow();
  contents.debugger.attach = () => { throw new Error("Another debugger is already attached"); };
  const lines = [];
  const ui = createLocalUi({ source: bundleSource(tmpdir()), origins: () => [CLOUD], log: (line) => lines.push(line) });
  await ui.attach(contents);
  assert.deepEqual(sent, []);
  assert.match(lines[0], /could not attach/);
});
