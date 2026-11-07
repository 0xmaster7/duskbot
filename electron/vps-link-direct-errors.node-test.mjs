import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import { newDirectKey, sshConnector } from "./vps-link-direct.mjs";

test("a connection dropped before the ssh handshake rejects the dial and never throws uncaught", async () => {
  const sockets = new Set();
  const server = createServer((socket) => { sockets.add(socket); socket.write("SSH-2.0-x\r\n"); setTimeout(() => socket.destroy(), 20); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    const { privateKey } = newDirectKey();
    const dial = sshConnector({ host: "127.0.0.1", port: server.address().port, user: "x", privateKey, hostKeys: ["ssh-ed25519 AAAA"], timeoutMs: 3000 });
    const outcome = await Promise.race([dial().then(() => "connected", () => "rejected"), new Promise((resolve) => setTimeout(() => resolve("hung"), 5000))]);
    assert.equal(outcome, "rejected");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", onUncaught);
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});
