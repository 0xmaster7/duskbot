// the reachability probe calls back the address that asked; that server's answer is read only as far as the nonce
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createLinkService, sha256hex } from "../src/app.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const token = "t".repeat(40), nonce = "n".repeat(20);
let server;
afterEach(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });

async function probeWith(body) {
  let pulled = 0, cancelled = false;
  const fetchStub = async () => new Response(new ReadableStream({
    pull(controller) { pulled += 1; controller.enqueue(new TextEncoder().encode(typeof body === "string" ? body : "x".repeat(64 * 1024))); if (typeof body === "string") controller.close(); },
    cancel() { cancelled = true; },
  }));
  const service = createLinkService({ base: "http://link.test", scriptPath: join(root, "install.sh"), agentPath: join(root, "agent.mjs"), trustProxy: true, fetch: fetchStub });
  server = createServer((req, res) => void service.handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, bearer, payload) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "8.8.8.8", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(payload) }).then((res) => res.json());
  const { id } = await call("/v1/sessions", null, { verifier: sha256hex(token), appPub: "a".repeat(43) });
  await call(`/v1/sessions/${id}/claim`, token, {});
  const answer = await call(`/v1/sessions/${id}/probe`, token, { nonce });
  service.close();
  return { answer, pulled, cancelled };
}

describe("reachability probe", () => {
  it("matches the nonce the server answers with", async () => {
    expect((await probeWith(`${nonce}\n`)).answer).toEqual({ ip: "8.8.8.8", reachable: true });
  });

  it("stops reading an endless answer instead of buffering it", async () => {
    const { answer, pulled, cancelled } = await probeWith(null);
    expect(answer.reachable).toBe(false);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(5);
  });
});
