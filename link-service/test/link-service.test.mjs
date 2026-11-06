// the link service end to end on loopback: a setup session as the app and the install script use it, the agent's real
// `link` command sealing a result only the app opens, and the sealed relay tunnel carrying requests, streams and control.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLinkService, publicIp } from "../src/app.mjs";
import { createTunnelAgent, open as agentOpen } from "../agent.mjs";
import { createRelayClient, createTunnelProxy, newLinkKeys, openResult, seal, sha256hex, vpsTokenOf } from "../../electron/vps-link-protocol.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

let dir, relayServer, service, base, fakeServer, fakePort, seen, largestPost = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-link-"));
  service = createLinkService({ base: "http://link.test", dataDir: join(dir, "data"), scriptPath: join(root, "install.sh"), agentPath: join(root, "agent.mjs"), trustProxy: false });
  relayServer = createServer((req, res) => { largestPost = Math.max(largestPost, Number(req.headers["content-length"] ?? 0)); void service.handler(req, res); });
  base = `http://127.0.0.1:${await listen(relayServer)}`;
  seen = [];
  // stands in for OpenMausBot on the vps
  fakeServer = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      if (req.url === "/api/auth/pairing") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ code: "RR8Y-BLR6-H939", expiresAt: 123 })); }
      if (req.url === "/.well-known/openmausbot/environment") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ environmentId: "6f1c2d3e-0000-4000-8000-000000000001" })); }
      if (req.url === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: one\n\n");
        setTimeout(() => { res.write("data: two\n\n"); res.end(); }, 150);
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "omb_session=abc; HttpOnly" });
      res.end(JSON.stringify({ echo: Buffer.concat(chunks).length, url: req.url }));
    });
  });
  fakePort = await listen(fakeServer);
});

afterAll(async () => {
  service.close();
  await new Promise((resolve) => relayServer.close(resolve));
  await new Promise((resolve) => fakeServer.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const post = (route, token, body) => fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

describe("setup sessions", () => {
  it("serves the script with the base and token baked in, and refuses a malformed token", async () => {
    const token = "abcdefghij-abcdefghijklmnopqrstuvwxyz";
    const script = await (await fetch(`${base}/i/${token}`)).text();
    if (script.includes("__LINK_TOKEN__") || script.includes("__LINK_BASE__")) throw new Error("placeholders left in the served script");
    expect(script).toContain("http://link.test");
    expect(script).toContain(token);
    expect((await fetch(`${base}/i/ABCDEFGHIJ-abcdefghijklmnopqrstuvwxyz`)).status).toBe(404);
  });

  it("runs a whole setup: claim, steps, result; the relay keeps only verifiers and the command is one-time", async () => {
    const relay = createRelayClient({ base });
    const keys = newLinkKeys();
    const made = await relay.create({ verifier: keys.verifier, appPub: keys.pub, label: "Sid's MacBook" });
    expect(made.id).toMatch(/^[a-z2-7]{10}$/);
    const vpsToken = vpsTokenOf(keys.secret);

    expect((await post(`/v1/sessions/${made.id}/claim`, "x".repeat(64), {})).status).toBe(401);
    const claim = await post(`/v1/sessions/${made.id}/claim`, vpsToken, { host: { arch: "aarch64", os: "Ubuntu 24.04" } });
    expect(claim.status).toBe(200);
    expect((await claim.json()).appPub).toBe(keys.pub);

    expect((await post(`/v1/sessions/${made.id}/events`, vpsToken, { step: "node", status: "running" })).status).toBe(200);
    // a long poll wakes on the next step
    const waiting = relay.watch(made.id, made.watch, 2);
    await post(`/v1/sessions/${made.id}/events`, vpsToken, { step: "node", status: "failed", log: "E: Unable to locate package nodejs" });
    const watched = await waiting;
    expect(watched.state).toBe("installing");
    expect(watched.events.map((event) => [event.step, event.status])).toEqual([["node", "failed"]]);
    expect(watched.events[0].log).toContain("nodejs");

    // live terminal lines: kept with their command, capped, and a bad shape refused
    const many = Array.from({ length: 60 }, (_, i) => `Get:${i} ${"x".repeat(500)}`);
    expect((await post(`/v1/sessions/${made.id}/events`, vpsToken, { step: "node", status: "running", cmd: "apt-get -y install nodejs", lines: many })).status).toBe(200);
    expect((await post(`/v1/sessions/${made.id}/events`, vpsToken, { step: "node", status: "running", lines: "nope" })).status).toBe(400);
    expect((await post(`/v1/sessions/${made.id}/events`, vpsToken, { step: "node", status: "running", lines: many.concat("one too many") })).status).toBe(400);
    const streamed = (await relay.watch(made.id, made.watch, watched.events[0].seq)).events[0];
    expect(streamed.cmd).toBe("apt-get -y install nodejs");
    expect(streamed.lines.length).toBeGreaterThan(10);
    expect(streamed.lines.every((line) => line.length <= 400)).toBe(true);
    expect(streamed.lines.join("").length).toBeLessThanOrEqual(16 * 1024);
    expect(streamed.lines.at(-1)).toMatch(/^Get:59 /);

    // the agent's own `link` command, with this suite's fake OpenMausBot as the server
    const home = mkdtempSync(join(dir, "home-"));
    await run(process.execPath, [join(root, "agent.mjs"), "link"], {
      env: { ...process.env, HOME: home, LINK_BASE: base, LINK_ID: made.id, LINK_TOKEN: vpsToken, LINK_MODE: "relay", LINK_NAME: "oracle-arm", LINK_SERVER_PORT: String(fakePort) },
    });
    const pairingAsk = seen.find((entry) => entry.url === "/api/auth/pairing");
    expect(JSON.parse(pairingAsk.body)).toEqual({ label: "Sid's MacBook" });
    const tunnelFile = join(home, ".config", "openmausbot-link", "tunnel.json");
    expect(statSync(tunnelFile).mode & 0o777).toBe(0o600);

    const done = await relay.watch(made.id, made.watch, 0);
    expect(done.state).toBe("linked");
    const result = openResult({ id: made.id, priv: keys.priv, pub: keys.pub, vpsPub: done.vpsPub, sealed: done.sealed });
    expect(result).toMatchObject({ mode: "relay", name: "oracle-arm", pairing: { code: "RR8Y-BLR6-H939" }, environmentId: "6f1c2d3e-0000-4000-8000-000000000001" });

    // nothing the relay wrote down opens the result or carries a token
    service.store.flush();
    const state = readFileSync(join(dir, "data", "state.json"), "utf8");
    expect(state).not.toContain(keys.secret);
    expect(state).not.toContain(vpsToken);
    expect(state).not.toContain(result.tunnel.token);
    expect(state).not.toContain("RR8Y");
    expect(state).toContain(sha256hex(result.tunnel.token));
    // the relay alone (it knows appPub, vpsPub and the sealed blob) cannot open it
    expect(() => agentOpen(Buffer.alloc(32), made.id, done.sealed)).toThrow();

    // the same command again is refused as used
    const again = await post(`/v1/sessions/${made.id}/claim`, vpsToken, {});
    expect(again.status).toBe(410);
    expect((await again.json()).code).toBe("used");
    // and the agent says "already linked" (exit 4) on a server that has its tunnel
    const rerun = await run(process.execPath, [join(root, "agent.mjs"), "link"], { env: { ...process.env, HOME: home, LINK_BASE: base, LINK_ID: made.id, LINK_TOKEN: vpsToken, LINK_SERVER_PORT: String(fakePort) } }).catch((error) => error);
    expect(rerun.code).toBe(4);
  });

  it("a cancelled session takes no more steps, and an unknown one reads as expired", async () => {
    const relay = createRelayClient({ base });
    const keys = newLinkKeys();
    const made = await relay.create({ verifier: keys.verifier, appPub: keys.pub });
    await relay.cancel(made.id, made.watch);
    expect((await post(`/v1/sessions/${made.id}/claim`, vpsTokenOf(keys.secret), {})).status).toBe(410);
    const unknown = await post("/v1/sessions/aaaaaaaaaa/claim", vpsTokenOf(keys.secret), {});
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).code).toBe("expired");
    // the watch token of one session reads no other
    expect((await fetch(`${base}/v1/sessions/aaaaaaaaaa/events`, { headers: { authorization: `Bearer ${made.watch}` } })).status).toBe(404);
  });

  it("probes only a public address: a private one is never fetched", async () => {
    expect(publicIp("10.0.0.5")).toBe(false);
    expect(publicIp("127.0.0.1")).toBe(false);
    expect(publicIp("100.70.1.1")).toBe(false);
    expect(publicIp("203.0.113.10")).toBe(true);
    const relay = createRelayClient({ base });
    const keys = newLinkKeys();
    const made = await relay.create({ verifier: keys.verifier, appPub: keys.pub });
    await post(`/v1/sessions/${made.id}/claim`, vpsTokenOf(keys.secret), {});
    const probe = await post(`/v1/sessions/${made.id}/probe`, vpsTokenOf(keys.secret), { nonce: "0123456789abcdef0123" });
    expect(await probe.json()).toEqual({ ip: "127.0.0.1", reachable: false });
  });
});

describe("the private server build", () => {
  it("is handed only to a claimed session with its own token, by sha256, a few times, and never after linking", async () => {
    const tgz = Buffer.from("pretend tarball ".repeat(4096));
    const sha = sha256hex(tgz);
    const packages = join(dir, "data", "packages");
    mkdirSync(packages, { recursive: true });
    writeFileSync(join(packages, `${sha}.tgz`), tgz);
    const kit = Buffer.from("pretend desktop kit");
    writeFileSync(join(packages, `${sha256hex(kit)}.tgz`), kit);
    writeFileSync(join(packages, "current.json"), JSON.stringify({ sha256: sha, version: "0.1.141", desktop: { sha256: sha256hex(kit), image: "ghcr.io/sidddevz/omb-bot-desktop:v1" } }));

    const relay = createRelayClient({ base });
    const keys = newLinkKeys();
    const made = await relay.create({ verifier: keys.verifier, appPub: keys.pub });
    const vpsToken = vpsTokenOf(keys.secret);
    const get = (route, token) => fetch(`${base}${route}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const route = `/pkg/${made.id}/${sha}.tgz`;

    expect((await get(route, vpsToken)).status).toBe(409);
    const claim = await (await post(`/v1/sessions/${made.id}/claim`, vpsToken, {})).json();
    expect(claim.package).toEqual({ sha256: sha, size: tgz.length, version: "0.1.141", path: route });
    expect(claim.desktop).toEqual({ sha256: sha256hex(kit), size: kit.length, image: "ghcr.io/sidddevz/omb-bot-desktop:v1", path: `/pkg/${made.id}/${sha256hex(kit)}.tgz` });
    expect(Buffer.from(await (await get(claim.desktop.path, vpsToken)).arrayBuffer()).equals(kit)).toBe(true);

    expect((await get(route)).status).toBe(401);
    expect((await get(route, "x".repeat(64))).status).toBe(401);
    expect((await get(`/pkg/${made.id}/${"0".repeat(64)}.tgz`, vpsToken)).status).toBe(404);
    // another session's token reads nothing of this one
    const other = newLinkKeys();
    const otherMade = await relay.create({ verifier: other.verifier, appPub: other.pub });
    await post(`/v1/sessions/${otherMade.id}/claim`, vpsTokenOf(other.secret), {});
    expect((await get(route, vpsTokenOf(other.secret))).status).toBe(401);

    const got = await get(route, vpsToken);
    expect(got.status).toBe(200);
    expect(got.headers.get("cache-control")).toContain("no-store");
    const body = Buffer.from(await got.arrayBuffer());
    expect(sha256hex(body)).toBe(sha);

    for (let i = 0; i < 8; i += 1) await (await get(route, vpsToken)).arrayBuffer();
    expect((await get(route, vpsToken)).status).toBe(429);

    await post(`/v1/sessions/${otherMade.id}/result`, vpsTokenOf(other.secret), { sealed: "abc", vpsPub: other.pub });
    expect((await get(`/pkg/${otherMade.id}/${sha}.tgz`, vpsTokenOf(other.secret))).status).toBe(410);
    // the script and the public routes never name the build
    expect(await (await fetch(`${base}/i`)).text()).not.toContain(sha);
  });

  it("advertises nothing when no build is published", async () => {
    rmSync(join(dir, "data", "packages"), { recursive: true, force: true });
    const relay = createRelayClient({ base });
    const keys = newLinkKeys();
    const made = await relay.create({ verifier: keys.verifier, appPub: keys.pub });
    const claim = await (await post(`/v1/sessions/${made.id}/claim`, vpsTokenOf(keys.secret), {})).json();
    expect(claim.package).toBeUndefined();
  });
});

describe("relay tunnel", () => {
  it("carries requests, bodies, streams and control end to end, marks them remote, and stops when forgotten", async () => {
    const relay = createRelayClient({ base });
    const keys = newLinkKeys();
    const made = await relay.create({ verifier: keys.verifier, appPub: keys.pub });
    const vpsToken = vpsTokenOf(keys.secret);
    await post(`/v1/sessions/${made.id}/claim`, vpsToken, {});
    const tunnel = { key: Buffer.alloc(32, 7).toString("base64url"), vps: "v".repeat(43), app: "a".repeat(43) };
    const sealedResult = seal(Buffer.alloc(32), made.id, Buffer.from("{}"));
    expect((await post(`/v1/sessions/${made.id}/result`, vpsToken, { sealed: sealedResult, vpsPub: keys.pub, tunnel: { vps: sha256hex(tunnel.vps), app: sha256hex(tunnel.app) } })).status).toBe(200);

    const agent = createTunnelAgent({ base, id: made.id, key: tunnel.key, token: tunnel.vps, server: { host: "127.0.0.1", port: fakePort }, log: () => {} });
    const running = agent.run();
    const proxy = createTunnelProxy({ base, id: made.id, key: tunnel.key, token: tunnel.app });
    const origin = await proxy.start();
    expect(origin).toMatch(new RegExp(`^http://vps-${made.id}\\.localhost:\\d+$`));
    const port = new URL(origin).port;
    // fetch cannot send a *.localhost host to 127.0.0.1 by name everywhere, so set the host header the browser would
    const call = (path, init = {}) => new Promise((resolve, reject) => {
      import("node:http").then(({ request }) => {
        const req = request({ host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: { host: `vps-${made.id}.localhost:${port}`, ...(init.headers ?? {}) } }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => { chunks.push(chunk); init.onChunk?.(chunk.toString()); });
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end(init.body);
      });
    });

    const got = await call("/api/bots?x=1", { headers: { origin: `http://vps-${made.id}.localhost:${port}` } });
    expect(got.status).toBe(200);
    expect(JSON.parse(got.text).url).toBe("/api/bots?x=1");
    expect(got.headers["set-cookie"]?.[0]).toContain("omb_session=abc");
    const arrived = seen.find((entry) => entry.url === "/api/bots?x=1");
    expect(arrived.headers["x-forwarded-for"]).toBe("192.0.2.10");
    expect(arrived.headers.host).toBe(`vps-${made.id}.localhost:${port}`);

    const big = "z".repeat(3 * 1024 * 1024);
    const posted = await call("/api/upload", { method: "POST", headers: { "content-type": "application/octet-stream", "content-length": String(big.length) }, body: big });
    expect(JSON.parse(posted.text).echo).toBe(big.length);
    // a proxy in front of the link service (nginx: 1 MB by default) never sees a bigger body
    expect(largestPost).toBeLessThan(1_000_000);

    const pieces = [];
    const stream = await call("/events", { onChunk: (text) => pieces.push(text) });
    expect(stream.text).toBe("data: one\n\ndata: two\n\n");
    expect(pieces.length).toBeGreaterThanOrEqual(2);

    expect(await proxy.control("ping")).toEqual({ ok: true });
    await expect(proxy.control("nope")).rejects.toThrow("unknown request");

    expect((await call("/x", { headers: { host: "evil.example:1" } })).status).toBe(421);

    await relay.forget(made.id, tunnel.app);
    expect(await running).toBe("unlinked");
    await proxy.close();
  }, 20_000);
});
