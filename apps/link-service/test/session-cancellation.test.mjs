import { createServer, request } from "node:http";
import { describe, expect, it } from "vitest";

import { createLinkService } from "../src/app.mjs";
import { createRelayClient, newLinkKeys, sha256hex, vpsTokenOf } from "../../../electron/vps-link-protocol.mjs";

async function fixture(fetchImpl) {
  let at = Date.now(), began;
  const started = new Promise((resolve) => { began = resolve; });
  const service = createLinkService({ base: "http://fixture.invalid", scriptPath: "/unused", agentPath: "/unused", now: () => at, trustProxy: true, fetch: fetchImpl });
  const server = createServer((req, res) => {
    void service.handler(req, res);
    if (req.headers["x-fixture-race"]) began();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const relay = createRelayClient({ base });
  const keys = newLinkKeys();
  const made = await relay.create({ verifier: keys.verifier, appPub: keys.pub });
  const token = vpsTokenOf(keys.secret);
  const post = (action, body) => fetch(`${base}/v1/sessions/${made.id}/${action}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-real-ip": "8.8.8.8" }, body: JSON.stringify(body) });
  return { service, relay, made, token, keys, base, post, started, expire: () => { at += 3 * 60 * 60_000; }, close: async () => {
    service.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  } };
}

for (const action of ["claim", "events", "probe", "result"]) {
  describe(`${action} terminal-state races`, () => {
    for (const terminal of ["cancelled", "expired"]) {
      it(`does not act after setup becomes ${terminal} while its body is arriving`, async () => {
        const target = await fixture(async () => Response.json({}));
        let req;
        try {
          if (action !== "claim") expect((await target.post("claim", {})).status).toBe(200);
          const body = JSON.stringify(action === "events" ? { step: "app", status: "done" }
            : action === "probe" ? { nonce: "a".repeat(32) }
              : action === "result" ? { sealed: "abc", vpsPub: target.keys.pub, tunnel: { vps: sha256hex("v".repeat(43)), app: sha256hex("a".repeat(43)) } } : {});
          const session = target.service.store.sessions.get(target.made.id);
          const sequence = session.seq;
          const reply = new Promise((resolve, reject) => {
            req = request(`${target.base}/v1/sessions/${target.made.id}/${action}`, { method: "POST", headers: {
              authorization: `Bearer ${target.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-fixture-race": "1", "x-real-ip": "8.8.8.8",
            } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
            req.on("error", reject);
            req.write(body.slice(0, -1));
          });
          await target.started;
          if (terminal === "cancelled") await target.relay.cancel(target.made.id, target.made.watch);
          else target.expire();
          req.end(body.slice(-1));
          expect(await reply).toBe(terminal === "cancelled" ? 410 : 404);
          expect(target.service.store.stateOf(session)).toBe(terminal);
          expect(session.seq).toBe(sequence);
          expect(target.service.store.tunnels.size).toBe(0);
        } finally {
          req?.destroy();
          await target.close();
        }
      });
    }
  });
}

it("does not publish a probe result after setup is cancelled during its network wait", async () => {
  let began, finish;
  const started = new Promise((resolve) => { began = resolve; });
  const waiting = new Promise((resolve) => { finish = resolve; });
  const target = await fixture(async () => { began(); await waiting; return new Response("a".repeat(32)); });
  try {
    expect((await target.post("claim", {})).status).toBe(200);
    const result = target.post("probe", { nonce: "a".repeat(32) });
    await started;
    await target.relay.cancel(target.made.id, target.made.watch);
    finish();
    expect((await result).status).toBe(410);
    expect(target.service.store.sessions.get(target.made.id).state).toBe("cancelled");
  } finally {
    finish();
    await target.close();
  }
});
