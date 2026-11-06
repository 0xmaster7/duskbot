// "Add your VPS" end to end on loopback, with the real link service, the real agent (its `link` and `tunnel` commands in
// their own processes and home folder) and a fake OpenMausBot on each side: command, live steps, the sealed result, the
// app signed in through the tunnel, AI sign-ins sent from this mac, and the move with its backup first.
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLinkService } from "../link-service/src/app.mjs";
import { STEP_IDS, createVpsLink } from "./vps-link.mjs";
import { vpsTokenOf } from "./vps-link-protocol.mjs";

const run = promisify(execFile);
const agentPath = fileURLToPath(new URL("../link-service/agent.mjs", import.meta.url));
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const until = async (check, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

let dir, relayServer, service, base, vpsServer, vpsPort, home, tunnelChild;
const vpsSeen = [];

/** fetch over node:http that keeps a host's cookies, as the app's session does, and reaches *.localhost on loopback */
function cookieFetch() {
  const jar = new Map();
  return (url, init = {}) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const headers = { ...(init.headers ?? {}), host: target.host, ...(jar.get(target.hostname) ? { cookie: jar.get(target.hostname) } : {}) };
    const req = httpRequest({ host: "127.0.0.1", port: target.port, path: `${target.pathname}${target.search}`, method: init.method ?? "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const cookie = res.headers["set-cookie"]?.[0];
        if (cookie) jar.set(target.hostname, cookie.split(";")[0]);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: Object.entries(res.headers).filter(([, value]) => typeof value === "string") }));
      });
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-vps-link-"));
  home = join(dir, "vps-home");
  mkdirSync(home);
  service = createLinkService({ base: "http://placeholder", dataDir: null, scriptPath: fileURLToPath(new URL("../link-service/install.sh", import.meta.url)), agentPath, trustProxy: false });
  relayServer = createServer((req, res) => void service.handler(req, res));
  base = `http://127.0.0.1:${await listen(relayServer)}`;
  // OpenMausBot on the vps
  vpsServer = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      vpsSeen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const reply = (status, value, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(value)); };
      const signedIn = /omb_session=good/.test(String(req.headers.cookie ?? ""));
      if (req.url === "/api/auth/pairing") return req.headers["x-forwarded-for"] ? reply(403, { error: "remote" }) : reply(200, { code: "RR8Y-BLR6-H939", expiresAt: 1 });
      if (req.url === "/.well-known/openmausbot/environment") return reply(200, { environmentId: "6f1c2d3e-0000-4000-8000-000000000001" });
      if (req.url === "/api/auth/pair") return JSON.parse(body).code === "RR8Y-BLR6-H939" ? reply(200, { session: {}, environment: { environmentId: "6f1c2d3e-0000-4000-8000-000000000001" } }, { "set-cookie": "omb_session=good; HttpOnly; Path=/" }) : reply(401, { error: "bad code" });
      if (req.url === "/api/auth/session") return reply(200, signedIn ? { kind: "session" } : { kind: "none" });
      if (!signedIn) return reply(403, { error: "pair this device" });
      if (req.url === "/api/instances?fresh=1") return reply(200, { instances: [
        { instanceId: "claude", driver: "claude", snapshot: { authenticated: false } },
        { instanceId: "codex", driver: "codex", snapshot: { authenticated: false } },
        { instanceId: "grok", driver: "grok", snapshot: {} },
      ] });
      return reply(404, { error: "not here" });
    });
  });
  vpsPort = await listen(vpsServer);
});

afterAll(async () => {
  tunnelChild?.kill();
  service.close();
  await new Promise((resolve) => relayServer.close(resolve));
  await new Promise((resolve) => vpsServer.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

function localServer({ exportFails = false } = {}) {
  const calls = [];
  const backupBytes = Buffer.from("encrypted-backup-bytes");
  const localRequest = async (route, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${route}`);
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (route === "/api/bots?messages=0") return json(200, { bots: [{ id: "b1", name: "Pixel", avatarUrl: "/api/attachments/p.png", tasks: [{}, {}] }, { id: "b2", name: "Mira", tasks: [{}] }] });
    if (route === "/api/cloud-send") return json(200, { items: [{ kind: "bot" }, { kind: "skill" }, { kind: "library-skill" }, { kind: "routine" }, { kind: "webhook" }, { kind: "login" }] });
    if (route === "/api/workspace-backup/export") return exportFails ? json(409, { error: "A backup is already running." }) : json(200, { id: "11111111-2222-4333-8444-555555555555", bytes: backupBytes.length, summary: { bots: 2, threads: 3, messages: 40 } });
    if (route.startsWith("/api/workspace-backup/download/")) return new Response(backupBytes, { status: 200 });
    if (route === "/api/move/forget") return json(200, { forgot: true });
    return json(404, { error: "not here" });
  };
  return { calls, localRequest };
}

function controller({ local, ownHome, store }) {
  const saved = [];
  const link = createVpsLink({
    base,
    serverFetch: cookieFetch(),
    store,
    protect: async (text) => `p:${text}`,
    unprotect: async (text) => text.slice(2),
    label: () => "Sid's MacBook",
    saveServer: ({ origin, name }) => { saved.push({ origin, name }); return "env-1"; },
    forgetServer: (id) => saved.push({ forgot: id }),
    switchTo: () => {},
    ownHome,
    ownHomeReset: () => {},
    localRequest: local.localRequest,
    backups: {
      async save(name, body) {
        const chunks = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        const file = join(dir, name);
        writeFileSync(file, Buffer.concat(chunks));
        return { file, bytes: Buffer.concat(chunks).length };
      },
      async open(file) { return { body: readFileSync(file), size: readFileSync(file).length }; },
    },
    localCredentials: {
      codexAuth: async () => JSON.stringify({ tokens: { access_token: "codex-on-the-mac" } }),
      claudeCli: async () => "/usr/local/bin/claude",
      claudeToken: async () => `Your token: sk-ant-oat01-${"a".repeat(40)}\n`,
    },
    relaunch: () => {},
    pollMs: 10,
  });
  return { link, saved };
}

const memoryStore = () => { let value = null; return { read: () => value, write: (next) => { value = JSON.parse(JSON.stringify(next)); } }; };
const post = (route, token, body) => fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

describe("Add your VPS", () => {
  it("links a server, signs its AI in from this mac, and moves everything with a backup first", async () => {
    const local = localServer();
    let phase = null;
    const started = [];
    const ownHome = { start: async (id) => { started.push(id); phase = { phase: "copy", chats: { done: 1, total: 3 } }; }, view: () => phase, away: () => phase?.phase === "done", home: () => null, chosen: () => null };
    const { link, saved } = controller({ local, ownHome, store: memoryStore() });

    const first = await link.start();
    expect(first.stage).toBe("command");
    const command = first.command;
    const token = /\/i\/([a-z2-7]{10}-[a-z2-7]{26}) \| sh$/.exec(command)?.[1];
    expect(command.startsWith("curl -fsSL http://placeholder/i/")).toBe(true);
    expect(token).toBeTruthy();
    expect(first.steps.map((step) => step.id)).toEqual(STEP_IDS);
    const [id, secret] = token.split("-");

    // the install script's reports, as they arrive
    const vpsToken = vpsTokenOf(secret);
    await post(`/v1/sessions/${id}/claim`, vpsToken, {});
    await post(`/v1/sessions/${id}/events`, vpsToken, { step: "check", status: "done" });
    await post(`/v1/sessions/${id}/events`, vpsToken, { step: "node", status: "failed", log: "curl: (6) Could not resolve host" });
    const failed = await until(() => { const seen = link.view(); return seen.steps.find((step) => step.id === "node").status === "failed" && seen; });
    expect(failed.stage).toBe("installing");
    expect(failed.steps.find((step) => step.id === "node").log).toContain("resolve host");
    await post(`/v1/sessions/${id}/events`, vpsToken, { step: "node", status: "done" });

    // the agent finishes the setup on the server and keeps the tunnel open
    await run(process.execPath, [agentPath, "link"], { env: { ...process.env, HOME: home, LINK_BASE: base, LINK_ID: id, LINK_TOKEN: vpsToken, LINK_MODE: "relay", LINK_NAME: "oracle-arm", LINK_SERVER_PORT: String(vpsPort) } });
    tunnelChild = spawn(process.execPath, [agentPath, "tunnel"], { env: { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), LINK_SERVER_PORT: String(vpsPort) }, stdio: "ignore" });

    const linked = await until(() => link.view().stage === "linked" && link.view());
    expect(linked.server).toMatchObject({ id: "env-1", name: "oracle-arm" });
    expect(linked.server.origin).toMatch(new RegExp(`^http://vps-${id}\\.localhost:\\d+$`));
    expect(linked.mode).toBe("relay");
    expect(saved[0]).toEqual({ origin: linked.server.origin, name: "oracle-arm" });
    // the pairing went through the tunnel, as a remote request the server checks
    const pair = vpsSeen.find((entry) => entry.url === "/api/auth/pair");
    expect(pair.headers["x-forwarded-for"]).toBeTruthy();
    expect(JSON.parse(pair.body)).toMatchObject({ code: "RR8Y-BLR6-H939", cookie: true, label: "Sid's MacBook" });

    const engines = await link.engines();
    expect(engines.map((engine) => engine.kind)).toEqual(["claude", "codex"]);
    expect(await link.signIn("codex")).toMatchObject({ phase: "succeeded" });
    expect(JSON.parse(readFileSync(join(home, ".codex", "auth.json"), "utf8")).tokens.access_token).toBe("codex-on-the-mac");
    const claude = await link.signIn("claude");
    expect(claude.phase).toBe("waiting");
    await until(async () => (await link.signInStatus("claude", claude.flowId)).phase === "succeeded");
    expect(readFileSync(join(home, ".config", "openmausbot", "engines.env"), "utf8")).toBe(`CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-${"a".repeat(40)}\n`);
    // no credential ever reached OpenMausBot's own http api on the server
    expect(vpsSeen.some((entry) => entry.body.includes("codex-on-the-mac") || entry.body.includes("sk-ant-oat01"))).toBe(false);

    expect(await link.preview()).toEqual({
      bots: [{ id: "b1", name: "Pixel", avatarUrl: "/api/attachments/p.png" }, { id: "b2", name: "Mira" }],
      chats: 3, messages: null, skills: 2, memories: null, routines: 2, apps: null, bytes: null,
    });

    await link.move();
    expect(started).toEqual(["env-1"]);
    expect(local.calls.indexOf("POST /api/workspace-backup/export")).toBeLessThan(local.calls.length);
    expect(link.backups()).toEqual([expect.objectContaining({ reason: "before-move", bytes: 22, summary: expect.objectContaining({ bots: 2, chats: 3 }) })]);
    await until(() => link.view().move?.step === "copy" && link.view().move.chats?.done === 1);
    expect(local.calls).not.toContain("POST /api/move/forget");
    phase = { phase: "finishing" };
    await until(() => link.view().move?.step === "verify");
    phase = { phase: "done", phone: false, held: [] };
    const moved = await until(() => link.view().stage === "moved" && link.view());
    expect(moved.move).toMatchObject({ step: "done", status: "done" });
    expect(local.calls.filter((call) => call === "POST /api/move/forget")).toHaveLength(1);

    await link.forget();
    expect(saved.at(-1)).toEqual({ forgot: "env-1" });
    await link.close();
  }, 30_000);

  it("removes nothing on this mac when the backup fails, and keeps the copy when something did not arrive", async () => {
    const failing = localServer({ exportFails: true });
    const ownHome = { start: async () => { throw new Error("should not start"); }, view: () => null, away: () => false, home: () => null, chosen: () => null };
    const store = memoryStore();
    store.write({ v: 1, current: "aaaaaaaaaa", links: [{ id: "aaaaaaaaaa", name: "box", mode: "direct", origin: "https://203-0-113-5.sslip.io", envId: "env-9", keyP: `p:${Buffer.alloc(32).toString("base64url")}`, tokenP: "p:token-token-token-token" }] });
    const proxyFactory = () => ({ start: async () => "http://vps-aaaaaaaaaa.localhost:1", control: async () => ({ ok: true }), close: async () => {} });
    const pins = [];
    const { link } = controller({ local: failing, ownHome, store });
    // a controller with a stub tunnel and a signed-in server, so only the move itself is under test
    const stubbed = createVpsLink({ ...linkDeps(failing, ownHome, store), proxyFactory, pin: (host, spki) => pins.push([host, spki]) });
    await link.close();
    await stubbed.move();
    const seen = stubbed.view();
    expect(seen.move).toMatchObject({ step: "backup", status: "failed", error: "A backup is already running." });
    expect(failing.calls).not.toContain("POST /api/move/forget");

    let phase = null;
    const fine = localServer();
    const leaving = { start: async () => { phase = { phase: "done", left: [{ label: "Pixel", error: "too big" }] }; }, view: () => phase, away: () => true, home: () => ({ id: "env-9", name: "box", origin: "https://203-0-113-5.sslip.io" }), chosen: () => null };
    const store2 = memoryStore();
    store2.write(store.read());
    const second = createVpsLink({ ...linkDeps(fine, leaving, store2), proxyFactory });
    store2.write({ ...store2.read(), move: null });
    await second.move();
    await until(() => second.view().stage === "moved");
    expect(fine.calls).not.toContain("POST /api/move/forget");
    expect(second.where()).toEqual({ place: "vps", server: { id: "env-9", name: "box", origin: "https://203-0-113-5.sslip.io" } });
    await stubbed.close();
    await second.close();
  });
});

function linkDeps(local, ownHome, store) {
  return {
    base,
    serverFetch: async (url) => new Response(JSON.stringify(String(url).endsWith("/api/auth/session") ? { kind: "session" } : {}), { status: 200 }),
    store, protect: async (text) => `p:${text}`, unprotect: async (text) => text.slice(2), label: () => "Mac",
    saveServer: () => "env-9", forgetServer: () => {}, switchTo: () => {}, ownHome, ownHomeReset: () => {}, localRequest: local.localRequest,
    backups: { async save(name, body) { let bytes = 0; for await (const chunk of body) bytes += chunk.length; return { file: join(dir, name), bytes }; }, async open() { throw new Error("no"); } },
    localCredentials: { codexAuth: async () => null, claudeCli: async () => null, claudeToken: async () => "" },
    relaunch: () => {}, pollMs: 10,
  };
}
