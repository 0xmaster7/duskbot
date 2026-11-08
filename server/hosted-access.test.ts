import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { SessionRegistry } from "./sessions.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "acme.example.test";
const EMAIL = "member@example.test";
const INSTANCES = { claude: {
  driver: "claudeAgent", config: { cli: join(ROOT, "server/testing/fake-claude-cli.ts") },
} };
let PORT: number;
let home: string;
let child: ChildProcess;
let log = "";
let pairedToken: string;
let fixtureEnv: NodeJS.ProcessEnv;

function call(path: string, options: { method?: string; cookie?: string; token?: string; local?: boolean; body?: unknown } = {}) {
  return new Promise<{ status: number; body: any; cookies: string[]; location?: string; contractVersion?: string | string[] }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: PORT, path, method: options.method ?? "GET", headers: {
      ...(options.local ? {} : { host: HOST, "x-forwarded-for": "203.0.113.8", "x-forwarded-proto": "https" }),
      ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    } }, (res) => {
      let raw = ""; res.on("data", (chunk) => raw += chunk);
      res.on("end", () => { let body: unknown = raw; try { body = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode!, body, cookies: res.headers["set-cookie"] ?? [], location: res.headers.location }); });
    });
    req.on("error", reject); req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}
async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await call("/api/health", { local: true })).status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Owned hosted fixture failed to start:\n${log}`);
}
async function restart(env: NodeJS.ProcessEnv = {}) {
  await waitForExit(child, { signal: "SIGTERM" });
  child = spawn(process.execPath, [join(ROOT, "server/index.ts")], { cwd: ROOT, env: { ...fixtureEnv, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk) => log += chunk); child.stderr?.on("data", (chunk) => log += chunk);
  await waitForHealth();
}

beforeAll(async () => {
  PORT = await freePortBlock([0, 1], 35_000, 5_000);
  home = mkdtempSync(join(tmpdir(), "omb-hosted-server-"));
  const data = join(home, ".openmausbot");
  mkdirSync(join(home, "static"));
  writeFileSync(join(home, "static", "index.html"), "<!doctype html><title>Fixture workspace</title>");
  const sessions = new SessionRegistry({ file: join(data, "sessions.json") });
  pairedToken = sessions.issue({ label: "Pre-existing QR device", scopes: ["admin", "client"] }).token;
  writeFileSync(join(data, "config.json"), JSON.stringify({ signIn: { admins: [EMAIL] }, instances: INSTANCES }));
  child = spawn(process.execPath, [join(ROOT, "server/index.ts")], { cwd: ROOT, env: fixtureEnv = {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
    OMB_STATIC_DIR: join(home, "static"), OMB_BROWSER_CONNECTION: join(home, "browser-connection.json"),
    OMB_ADMIN_URL: "https://admin.example.test", OMB_ADMIN_WORKSPACE: "acme", OMB_PUBLIC_URL: `https://${HOST}`,
    OMB_ADMIN_MEMBERSHIP: "portal", OMB_LOOPBACK_TRUST: "owner",
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk) => log += chunk); child.stderr?.on("data", (chunk) => log += chunk);
  await waitForHealth();
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  const evidenceDir = join(tmpdir(), "openmausbot-verification-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const logPath = join(evidenceDir, `hosted-access-${Date.now()}-${process.pid}.log`);
  writeFileSync(logPath, log);
  console.info(JSON.stringify({ logPath }));
  await removeTempDir(home);
});

async function createBot() {
  const catalog = await call("/api/instances", { local: true });
  const provider = catalog.body.instances.find((instance: any) => instance.instanceId === "claude");
  const created = await call("/api/bots", { method: "POST", local: true, body: {
    name: "Hosted policy fixture", requireAvailableModel: true, modelSelection: { instanceId: "claude", model: provider.models.default },
  } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.bot.approvalMode).toBe("ask");
  return created.body.bot.id as string;
}

describe("hosted configuration without a sign-in provider", () => {
  it("fails closed while retaining explicit local owner access", async () => {
    for (const path of ["/api/health/hosted", "/api/auth/hosted/start", "/api/auth/hosted/callback", "/", "/pair"]) {
      expect((await call(path)).status, path).toBe(503);
    }
    expect((await call("/", { local: true })).body).toContain("Fixture workspace");
    expect((await call("/.well-known/openmausbot/environment")).body.capabilities.emailSignIn).toBe(false);
    for (const path of ["/api/auth/pair", "/api/pair", "/api/auth/pairing", "/api/auth/email/start", "/api/auth/email/verify"]) {
      expect((await call(path, { method: "POST" })).status, path).toBe(403);
    }
    for (const token of [pairedToken]) {
      expect((await call("/api/auth/session", { token })).status).toBe(503);
    }
    expect((await call("/api/auth/session", { local: true })).body.kind).toBe("loopback");
    const botId = await createBot();
    const health = await call("/api/health", { local: true });
    expect(health.body.capabilities.sharedWorkspaceFullAccess).toBeUndefined();
    expect((await call(`/api/bots/${botId}/tasks`, { method: "POST", local: true, body: { title: "Refused Full", approvalMode: "full" } })).status).toBe(403);
  });

  it.each([
    ["standalone", { OMB_ADMIN_URL: undefined, OMB_ADMIN_WORKSPACE: undefined, OMB_ADMIN_MEMBERSHIP: undefined }],
    ["incomplete hosted configuration", { OMB_ADMIN_URL: undefined }],
    ["invalid workspace", { OMB_ADMIN_WORKSPACE: "../private" }],
    ["invalid membership mode", { OMB_ADMIN_MEMBERSHIP: "invalid" }],
    ["local membership mode", { OMB_ADMIN_MEMBERSHIP: "local" }],
  ] satisfies [string, NodeJS.ProcessEnv][])("refuses hosted readiness for %s", async (_name, env) => {
    await restart(env);
    const readiness = await call("/api/health/hosted");
    expect(readiness.status).toBe(503);
    expect(readiness.body).toEqual({ error: "Hosted workspace readiness is unavailable." });
    expect((await call("/api/health")).status).toBe(200);
  }, 25_000);

  it("treats a session-less local caller as a service by default", async () => {
    await restart();
    const botId = await createBot();
    await restart({ OMB_LOOPBACK_TRUST: undefined });
    expect(log).toContain("local requests: service trust (hosted workspace)");
    expect((await call("/api/auth/session", { local: true })).body).toMatchObject({ kind: "loopback", scopes: ["client"], trust: "service" });
    const health = await call("/api/health", { local: true });
    expect(health.status).toBe(200);
    expect(health.body.capabilities).toMatchObject({ guardedMessages: 1, guardedRequests: 1 });
    expect(health.body.capabilities.sharedWorkspaceFullAccess).toBeUndefined();
    expect((await call("/api/bots?messages=0", { local: true })).status).toBe(200);
    const task = await call(`/api/bots/${botId}/tasks`, { method: "POST", local: true, body: { title: "Slack fixture", approvalMode: "ask" } });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const page = await call(`/api/threads/${threadId}/messages?limit=0`, { local: true });
    expect(page.status).toBe(200);
    const sendId = "slackjob_0123456789abcdef";
    const sent = await call(`/api/bots/${botId}/messages/guarded`, { method: "POST", local: true, body: {
      threadId, text: "hello from Slack", sendId, expectedActiveLeafId: page.body.activeLeafId ?? null, expectedApprovalMode: "ask",
    } });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect((await call(`/api/bots/${botId}/requests/${sendId}?threadId=${threadId}`, { local: true })).status).toBe(200);
    for (const [method, path, body] of [
      ["PUT", "/api/config", { language: "en" }],
      ["POST", "/api/webhooks", { name: "Backdoor", prompt: "hi", botId }],
      ["GET", "/api/auth/sessions"],
      ["POST", "/api/bots", { name: "Rogue" }],
      ["PATCH", `/api/bots/${botId}`, { approvalMode: "auto", acknowledgeLocalAuto: true }],
      ["POST", `/api/bots/${botId}/messages`, { text: "unguarded", threadId }],
      ["GET", "/api/config"],
    ] as const) {
      const response = await call(path, { method, local: true, ...(body === undefined ? {} : { body }) });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.body.error).toMatch(/shared server/);
    }
  }, 30_000);
});
