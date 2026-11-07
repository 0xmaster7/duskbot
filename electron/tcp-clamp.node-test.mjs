import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { connect, createServer } from "node:net";
import test from "node:test";

import { SAFE_MSS, clampMss } from "./tcp-clamp.mjs";

test("a connected socket sends at most the safe mss and still reads and writes everything", { skip: process.platform !== "darwin" || !existsSync("/usr/bin/perl") }, async () => {
  const server = createServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const socket = connect(server.address().port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    assert.equal(await clampMss(socket, { readBack: true }), SAFE_MSS);
    let echoed = 0;
    socket.on("data", (chunk) => { echoed += chunk.length; });
    socket.end(Buffer.alloc(200_000));
    await new Promise((resolve) => socket.once("close", resolve));
    assert.equal(echoed, 200_000);
  } finally { server.close(); }
});

test("elsewhere, or without a socket of its own, nothing runs", async () => {
  let spawned = 0;
  const spawnImpl = () => { spawned += 1; throw new Error("no"); };
  assert.equal(await clampMss({ _handle: { fd: 9 } }, { platform: "linux", spawnImpl }), false);
  assert.equal(await clampMss({ _handle: {} }, { platform: "darwin", spawnImpl }), false);
  assert.equal(await clampMss(null, { platform: "darwin", spawnImpl }), false);
  assert.equal(await clampMss({ _handle: { fd: 9 } }, { platform: "darwin", spawnImpl }), false);
  assert.equal(spawned, 1);
});
