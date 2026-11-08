#!/usr/bin/env node
// Runs a fixed set of everyday bot requests against a live server's test bots, one after another, and records how
// each turn went from the engine's native log: time to first activity and first text, tool calls, how many ran at
// once, wall time, and the reply. Run it on the server, as the user it runs as:
//   node scripts/live-scenarios.mjs --label before --out /tmp/omb-scenarios [--only s1,s2] [--bot Cinder]
// Read-only on the person's Mac except for writes into ~/Downloads/<bot>/.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
const label = opt("label", "run");
const outDir = opt("out", "/tmp/omb-scenarios");
const only = opt("only", "")?.split(",").filter(Boolean) ?? [];
const botOverride = opt("bot", "");
const dataDir = opt("data", join(homedir(), ".openmausbot"));
const cli = opt("cli", "openmausbot");

export const SCENARIOS = [
  { id: "s1-research", bot: "Atlas", text: "Quick research: what are the current stable versions of Node.js, Bun and Deno, and when was each released? Search the web for all three, then answer in three short lines with a source link each." },
  { id: "s2-title", bot: "Cinder", text: "Open siddz.com in your computer and give me the page title." },
  { id: "s3-tabs", bot: "Bolt", text: "Open 3 tabs in your computer's browser: news.ycombinator.com, github.com/trending and x.com. Summarise each in one line." },
  { id: "s4-app", bot: "Moss", text: "Launch an app on your computer (a text editor is fine) and tell me once it is open." },
  { id: "s5-download", bot: "Basil", text: "Download https://example.com/ to my Mac's Downloads folder and tell me the saved path." },
  { id: "s6-uname", bot: "Harness", text: "Run `uname -a` on my Mac and tell me the output." },
  { id: "s7-ip", bot: "Atlas", text: "What's my public IP from your computer? Check it in your computer's browser (for example api.ipify.org) and tell me the address." },
];

function run(command, argv, timeoutMs) {
  return new Promise((resolve) => {
    execFile(command, argv, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
}

/** Per-turn numbers from a Codex app-server native log, for everything logged at or after `since`. */
export function analyzeNative(lines, since) {
  const events = [];
  for (const line of lines) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row.at ?? "");
    if (!Number.isFinite(at) || at < since) continue;
    events.push({ at, dir: row.dir, msg: row.msg ?? {} });
  }
  const turns = [];
  let turn = null;
  const open = new Map();
  for (const { at, dir, msg } of events) {
    const method = msg.method;
    if (dir === "out" && method === "initialize") { turn = { spawnAt: at, startAt: null, endAt: null, firstItemAt: null, firstTextAt: null, tools: [], texts: [], mcpReadyAt: null, errors: [] }; turns.push(turn); continue; }
    if (!turn) continue;
    if (method === "mcpServer/startupStatus/updated" && msg.params?.status !== "starting") turn.mcpReadyAt = at;
    if (method === "mcpServer/startupStatus/updated" && msg.params?.status === "failed") turn.errors.push(`mcp ${msg.params.name} failed: ${msg.params.error ?? ""}`);
    if (dir === "out" && method === "turn/start") turn.startAt = at;
    if (method === "turn/completed") turn.endAt = at;
    if (method === "error" || method === "turn/failed") turn.errors.push(JSON.stringify(msg.params ?? {}).slice(0, 300));
    if (method === "item/started" || method === "item/completed") {
      const item = msg.params?.item ?? {};
      if (item.type === "userMessage") continue;
      if (method === "item/started" && turn.firstItemAt === null && item.type !== "reasoning") turn.firstItemAt = at;
      if (item.type === "agentMessage") {
        if (method === "item/started" && turn.firstTextAt === null) turn.firstTextAt = at;
        if (method === "item/completed") turn.texts.push(String(item.text ?? ""));
        continue;
      }
      if (item.type === "reasoning") continue;
      if (method === "item/started") { open.set(item.id, { at, item }); continue; }
      const started = open.get(item.id);
      open.delete(item.id);
      const start = item.startedAtMs ?? started?.at ?? at;
      const end = item.completedAtMs ?? at;
      const name = item.type === "mcpToolCall" ? `${item.server}.${item.tool}` : item.type === "webSearch" ? "web_search" : item.type === "commandExecution" ? "shell" : item.type;
      const error = item.error ? (typeof item.error === "string" ? item.error : item.error.message ?? JSON.stringify(item.error)) : item.result?.isError ? JSON.stringify(item.result.content ?? "").slice(0, 200) : "";
      turn.tools.push({ name, start, end, ms: end - start, ...(error ? { error: String(error).slice(0, 300) } : {}) });
    }
  }
  const maxConcurrent = (tools) => {
    const edges = tools.flatMap((tool) => [[tool.start, 1], [Math.max(tool.end, tool.start + 1), -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let now = 0, best = 0;
    for (const [, step] of edges) { now += step; best = Math.max(best, now); }
    return best;
  };
  return turns.map((one) => ({
    spawnToStartMs: one.startAt && one.spawnAt ? one.startAt - one.spawnAt : null,
    startToFirstItemMs: one.startAt && one.firstItemAt ? one.firstItemAt - one.startAt : null,
    startToFirstTextMs: one.startAt && one.firstTextAt ? one.firstTextAt - one.startAt : null,
    turnMs: one.startAt && one.endAt ? one.endAt - one.startAt : null,
    toolCount: one.tools.length,
    maxConcurrent: maxConcurrent(one.tools),
    toolMs: one.tools.reduce((sum, tool) => sum + tool.ms, 0),
    tools: one.tools.map((tool) => `${tool.name}:${tool.ms}${tool.error ? `!${tool.error}` : ""}`),
    textBubbles: one.texts.filter((text) => text.trim()).length,
    errors: one.errors,
    spawnAt: one.spawnAt,
    startAt: one.startAt,
    firstItemAt: one.firstItemAt,
    firstTextAt: one.firstTextAt,
  }));
}

async function scenario(item) {
  const bot = botOverride || item.bot;
  const sentAt = Date.now();
  const title = `speed ${label} ${item.id}`;
  const res = await run(cli, ["run", bot, item.text, "--title", title, "--wait", "job", "--timeout", "6m", "--on-input", "exit", "--json", "--quiet"], 7 * 60_000);
  const doneAt = Date.now();
  let result = {};
  try { result = JSON.parse(res.stdout); } catch { result = { ok: false, error: (res.stdout || res.stderr || String(res.error)).slice(0, 500) }; }
  const threadId = result.threadId;
  const nativeFile = threadId ? join(dataDir, "native", `${threadId}.ndjson`) : "";
  const turns = nativeFile && existsSync(nativeFile) ? analyzeNative(readFileSync(nativeFile, "utf8").split("\n"), sentAt) : [];
  const firstTurn = turns[0];
  const allTools = turns.flatMap((one) => one.tools);
  return {
    id: item.id, label, bot, threadId, state: result.state ?? (result.ok ? "completed" : "failed"), exitCode: result.exitCode,
    wallMs: doneAt - sentAt,
    sendToSpawnMs: firstTurn?.spawnAt ? firstTurn.spawnAt - sentAt : null,
    sendToFirstItemMs: firstTurn?.firstItemAt ? firstTurn.firstItemAt - sentAt : null,
    sendToFirstTextMs: turns.find((one) => one.firstTextAt)?.firstTextAt ? turns.find((one) => one.firstTextAt).firstTextAt - sentAt : null,
    nativeTurns: turns.length,
    toolCount: allTools.length,
    maxConcurrent: Math.max(0, ...turns.map((one) => one.maxConcurrent)),
    toolErrors: allTools.filter((tool) => tool.includes("!")).length,
    turns: turns.map(({ spawnAt, startAt, firstItemAt, firstTextAt, ...rest }) => rest),
    reply: String(result.reply?.text ?? result.reply ?? "").slice(0, 1200),
    error: result.error ?? result.reason ?? null,
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${label}.jsonl`);
  for (const item of SCENARIOS.filter((one) => !only.length || only.includes(one.id) || only.includes(one.id.split("-")[0]))) {
    const record = await scenario(item);
    appendFileSync(file, JSON.stringify(record) + "\n");
    console.log(`${record.id} ${record.state} wall=${record.wallMs} firstItem=${record.sendToFirstItemMs} tools=${record.toolCount} max||=${record.maxConcurrent} turns=${record.nativeTurns}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
