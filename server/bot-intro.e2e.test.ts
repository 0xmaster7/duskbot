import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

// A bot just made says hello in its own voice: one turn with no line from the person, its role in the prompt, and
// never a second hello.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const HELLO = "Hi, I'm Ledger. I keep your books tidy. Want me to start with last month's receipts?";

let child: ChildProcess;
let home = "";
let base = "";
let output = "";
let dump = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const messages = async (threadId: string): Promise<Array<{ role: string; kind: string; text?: string }>> =>
  (await api("GET", `/api/threads/${threadId}/messages`)).body.messages;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "dusk-bot-intro-"));
  const data = join(home, ".duskbot");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Bot intro test</title>");
  writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
  dump = join(home, "dump.json");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      intro: {
        driver: "claudeAgent", displayName: "Intro fixture", config: { cli: FAKE_CLAUDE },
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify([HELLO, HELLO]) },
      },
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      DUSK_PORT: String(port),
      DUSK_WEBHOOK_PORT: String(port + 1),
      DUSK_STATIC_DIR: staticDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${output}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

describe("a new bot's intro", { timeout: 60_000 }, () => {
  it("greets once in its own voice, with no line from the person, and never twice", async () => {
    const { bot } = (await api("POST", "/api/bots", {
      name: "Ledger", title: "Bookkeeper", greeting: false, useDefaults: false,
      modelSelection: { instanceId: "intro", model: "claude-sonnet-5" }, requireAvailableModel: true,
    })).body;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { soul: "You keep the person's books.", memoryUpkeep: false })).status).toBe(200);
    expect(await messages(bot.threadId)).toEqual([]);

    const started = await api("POST", `/api/bots/${bot.id}/intro`);
    expect(started.status).toBe(202);
    const deadline = Date.now() + 20_000;
    let thread = await messages(bot.threadId);
    while (!thread.some((message) => message.role === "bot" && message.text === HELLO) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      thread = await messages(bot.threadId);
    }
    expect(thread.filter((message) => message.role === "user")).toEqual([]);
    expect(thread.filter((message) => message.role === "bot" && message.kind === "text").map((message) => message.text)).toEqual([HELLO]);

    expect(existsSync(dump)).toBe(true);
    const sent = JSON.parse(readFileSync(dump, "utf8")) as { prompt: unknown; systemPrompt: string };
    expect(JSON.stringify(sent.prompt)).toContain("You were just created");
    expect(sent.systemPrompt).toContain("You keep the person's books.");

    for (let quiet = Date.now() + 5_000; Date.now() < quiet;) {
      if (!(await api("GET", "/api/bots?messages=0")).body.bots.find((each: { id: string }) => each.id === bot.id)?.busy) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await api("POST", `/api/bots/${bot.id}/intro`)).body).toEqual({ skipped: true });
    expect((await messages(bot.threadId)).filter((message) => message.role === "bot" && message.kind === "text")).toHaveLength(1);
  });

  it("knows no bot it cannot find", async () => {
    expect((await api("POST", "/api/bots/nope/intro")).status).toBe(404);
  });
});
