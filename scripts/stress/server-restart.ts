// The server stops mid-turn (a clean SIGTERM, then a SIGKILL crash) and starts again on the same data: the person's
// message is kept once, the cut turn ends in plain words instead of staying "working", a client's retried send is not
// a second message, and the next message gets a reply. Fake engine, temporary home.
//   node --experimental-strip-types scripts/stress/server-restart.ts
import { randomUUID } from "node:crypto";
import { launchRestartableServer } from "../../server/testing/restartable-server.ts";

process.env.FAKE_CLAUDE_TOOL_CALLS = "[]";
const server = await launchRestartableServer();
const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${server.url}${path}`, { method, headers: { origin: server.url, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
};
const until = async (check: () => Promise<boolean>, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise((d) => setTimeout(d, 250)); } return false; };
const results: Record<string, unknown> = {};
try {
  const created = await api("POST", "/api/bots", { name: "Restart" });
  const bot = created.bot as { id: string; threadId: string };
  await api("PATCH", `/api/bots/${bot.id}`, { computer: "off", browser: false });
  for (const how of ["SIGTERM", "SIGKILL"] as const) {
    // the engine hangs mid-turn, as a long tool call would
    process.env.FAKE_CLAUDE_MODE = "hang";
    await server.stop(); await server.start();
    const sendId = randomUUID().replaceAll("-", "");
    const text = `long job ${how}`;
    await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId, sendId });
    const running = await until(async () => (await api("GET", `/api/threads/${bot.threadId}/job?scope=turn`)).state === "running", 15_000);
    if (how === "SIGKILL") {
      const { execFileSync } = await import("node:child_process");
      const pid = Number(execFileSync("lsof", ["-ti", `tcp:${server.port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0]);
      process.kill(pid, "SIGKILL");
      results.killedPid = pid;
      await new Promise((d) => setTimeout(d, 500));
    }
    process.env.FAKE_CLAUDE_MODE = "happy";
    const t0 = Date.now();
    await server.stop(); await server.start();
    const restartMs = Date.now() - t0;
    let job: any;
    const settled = await until(async () => { job = await api("GET", `/api/threads/${bot.threadId}/job?scope=turn`); return job.state !== "running"; }, 60_000);
    const retried = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId, sendId });
    await until(async () => (await api("GET", `/api/threads/${bot.threadId}/job?scope=turn`)).state !== "running", 30_000);
    const page = await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`);
    const messages = page.messages as Array<{ role: string; kind: string; text?: string; tool?: { name: string } }>;
    const copies = messages.filter((m) => m.role === "user" && m.text === text).length;
    const after = messages.slice(messages.findIndex((m) => m.role === "user" && m.text === text) + 1).filter((m) => m.kind !== "digest")
      .map((m) => `${m.role}/${m.kind}: ${String(m.text || m.tool?.name || "").slice(0, 140)}`);
    const next = await api("POST", `/api/bots/${bot.id}/messages`, { text: `after ${how}`, threadId: bot.threadId });
    const replied = await until(async () => {
      const latest = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=5`)).messages as Array<{ role: string; kind: string; text?: string }>;
      return latest.some((m) => m.role === "bot" && m.kind === "text" && /hello from fake claude/.test(m.text ?? "")) && latest.at(-1)?.role !== "user";
    }, 30_000);
    results[how] = { wasRunning: running, restartMs, settledAfterRestart: settled, jobState: job?.state, userCopies: copies, retriedStatus: retried.status,
      shownAfterCut: after, nextAccepted: next.status, nextReplied: replied };
    console.error(how, JSON.stringify(results[how]));
  }
} catch (error) {
  results.error = error instanceof Error ? error.stack : String(error);
} finally {
  console.log(JSON.stringify(results, null, 2));
  await server.close();
}
