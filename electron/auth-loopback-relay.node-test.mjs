import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { createLoopbackRelay } from "./auth-loopback-relay.mjs";

const freePort = () => new Promise((resolve) => {
  import("node:net").then(({ createServer }) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
});
const get = (port, path, host = `localhost:${port}`) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location ?? null, body }));
  });
  req.on("error", reject);
  req.end();
});

test("hands the browser's callback to the page and sends the browser on to the provider's page", async () => {
  const relay = createLoopbackRelay();
  const port = await freePort();
  assert.equal(await relay.open(port, "/callback"), true);
  const waiting = relay.next(port);
  const browser = get(port, "/callback?code=fixture&state=abc");
  assert.equal(await waiting, `http://localhost:${port}/callback?code=fixture&state=abc`);
  relay.done(port, { ok: true, location: "https://platform.claude.com/oauth/code/success?app=claude-code" });
  const answer = await browser;
  assert.equal(answer.status, 302);
  assert.equal(answer.location, "https://platform.claude.com/oauth/code/success?app=claude-code");
  // closed after one sign-in
  await assert.rejects(get(port, "/callback?code=again&state=abc"));
});

test("refuses other paths and hosts, never redirects to a non-https page, and reports a taken port", async () => {
  const relay = createLoopbackRelay();
  const port = await freePort();
  assert.equal(await relay.open(port, "/auth/callback"), true);
  assert.equal((await get(port, "/other?code=x")).status, 404);
  assert.equal((await get(port, "/auth/callback?code=x", `evil.example:${port}`)).status, 404);
  assert.equal(await createLoopbackRelay().open(port, "/auth/callback"), false);
  const browser = get(port, "/auth/callback?code=x&state=y");
  await relay.next(port);
  relay.done(port, { ok: true, location: "http://localhost:1455/success?id_token=x" });
  const answer = await browser;
  assert.equal(answer.status, 200);
  assert.match(answer.body, /You're signed in/);
  assert.equal(await relay.open(80, "/callback"), false);
  assert.equal(await relay.open(port, "/../etc"), false);
});

test("a failed or abandoned sign-in tells the browser plainly and frees the port", async () => {
  const relay = createLoopbackRelay({ answerMs: 50 });
  const port = await freePort();
  assert.equal(await relay.open(port, "/"), true);
  const answer = await get(port, "/?code=x");
  assert.equal(answer.status, 200);
  assert.match(answer.body, /did not finish/);
  assert.equal(await relay.next(port), null);
});
