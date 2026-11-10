// Quiet routines and the weekly allowance against the isolated fixture and the fake engine (docs/verification): a probe
// check that wakes no model when nothing changed, one run when the page did, a failed read that surfaces, the strip;
// and the allowance's 80% and 100% notices, held runs, a refused new task and Saver mode.
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";

let session: VerificationServer | null = null;
let pages: Server | null = null;
afterEach(async () => {
  if (session) { console.info(JSON.stringify(session.info)); await session.close(); }
  pages?.close();
  session = null;
  pages = null;
});

async function launch(env: Record<string, string> = {}) {
  session = await launchVerificationServer({ ...env });
  const url = session.info.url;
  const control = (args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };
  const usageRows = () => {
    const file = join(session!.info.dataDir, "usage", `${new Date().toISOString().slice(0, 7)}.jsonl`);
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const runsOf = async (routineId: string) => ((await api("GET", "/api/routines")).body.runs as any[]).filter((run) => run.routineId === routineId);
  const routineOf = async (routineId: string) => ((await api("GET", "/api/routines")).body.routines as any[]).find((one) => one.id === routineId);
  /** Starts it now and waits for that run to finish. */
  const runNow = async (routineId: string) => {
    const started = await api("POST", `/api/routines/${routineId}/run`);
    expect(started.status).toBe(201);
    let run: any;
    await expect.poll(async () => { run = (await runsOf(routineId)).find((one) => one.id === started.body.run.id); return run?.status; }, { timeout: 30_000 })
      .toMatch(/^(completed|failed|missed|cancelled)$/);
    return run;
  };
  const notices = async (botId: string) => ((await control(["messages", "--bot", botId, "--limit", "50"])).messages as any[] ?? [])
    .map((message) => message.tool?.name ?? message.text ?? "").filter((text: string) => typeof text === "string" && text.startsWith("notice: "));
  return { control, api, usageRows, runsOf, routineOf, runNow, notices, dataDir: session.info.dataDir };
}

describe("a quiet routine", () => {
  it("reads the page in plain code, wakes the model only for a change, surfaces a failed read and keeps the strip", async () => {
    let page = { status: 200, body: "<html><body><h1>Release notes</h1><p>Version 1.0</p></body></html>" };
    pages = createServer((_req, res) => { res.writeHead(page.status, { "content-type": "text/html" }); res.end(page.body); });
    await new Promise<void>((resolve) => pages!.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`;
    const f = await launch({ DUSK_PROBE_LOOPBACK_ORIGIN: origin });
    const bot = (await f.control(["new-bot", "--name", "Watcher"])).bot;
    const created = await f.api("POST", "/api/routines", {
      name: "Release notes", prompt: "Tell me what is new in the release notes.", botId: bot.id,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 60 * 60_000 }, probe: { kind: "page", url: `${origin}/notes` },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const routine = created.body.routine;
    expect(routine).toMatchObject({ checks: ["probe"], probe: { kind: "page" } });
    // a frequent routine made without a window runs in the person's waking hours (none learned yet: 7 AM to 11 PM)
    expect(routine.schedule.window).toEqual({ start: "07:00", end: "23:00" });

    expect(await f.runNow(routine.id)).toMatchObject({ status: "completed", report: { state: "quiet" } });
    expect(await f.runNow(routine.id)).toMatchObject({ status: "completed", report: { state: "quiet" } });
    expect(f.usageRows()).toHaveLength(0);

    page = { ...page, body: page.body.replace("Version 1.0", "Version 1.1 adds dark mode") };
    const changed = await f.runNow(routine.id);
    expect(changed.status).toBe("completed");
    expect(f.usageRows()).toHaveLength(1);
    const dump = JSON.parse(readFileSync(session!.fixtureDumpPath, "utf8"));
    expect(JSON.stringify(dump)).toContain("changed since the last check");
    expect(JSON.stringify(dump)).toContain("Version 1.1 adds dark mode");

    page = { status: 500, body: "down" };
    const broken = await f.runNow(routine.id);
    expect(broken).toMatchObject({ status: "failed" });
    expect(broken.error).toMatch(/^Couldn't check 127\.0\.0\.1: The page answered 500\./);
    expect(f.usageRows()).toHaveLength(1);

    const after = await f.routineOf(routine.id);
    expect(after.strip.map((entry: any) => entry.outcome)).toEqual(["quiet", "quiet", "ok", "failed"]);
  }, 180_000);
});

describe("the weekly allowance", () => {
  it("tells at 80% and 100%, holds new work, and keeps chat going only in Saver mode", async () => {
    const f = await launch();
    const bot = (await f.control(["new-bot", "--name", "Research"])).bot;
    const daily = await f.api("POST", "/api/routines", { name: "Morning digest", prompt: "Write my digest.", botId: bot.id, schedule: { type: "daily", time: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    expect(daily.status).toBe(201);
    // a daily routine in waking hours, made with no timing, runs around its time
    expect(daily.body.routine.timing).toBe("around");
    expect((await f.api("PUT", "/api/usage/allowance", { usd: 0.05 })).body).toMatchObject({ weeklyUsd: 0.05, level: "ok", autoTopUp: { on: false } });

    const turn = async (text: string) => {
      await f.control(["send", "--bot", bot.id, "--text", text]);
      expect(JSON.stringify(await f.control(["wait", "--bot", bot.id, "--timeout", "30"]))).toContain("settled");
    };
    for (let n = 1; n <= 3; n++) await turn(`question ${n}`);
    expect(await f.notices(bot.id)).toEqual([]);
    await turn("question 4");
    await expect.poll(() => f.notices(bot.id), { timeout: 10_000 }).toEqual([
      "notice: You've used $0.04 of $0.05 this week. Most of it went to Research ($0.04). Resets Monday 12:00 AM.",
    ]);
    expect((await f.api("GET", "/api/usage/allowance")).body).toMatchObject({ level: "near", spentUsd: 0.04, top: [{ kind: "bot", name: "Research", usd: 0.04 }] });

    await turn("question 5");
    await expect.poll(async () => (await f.notices(bot.id)).length, { timeout: 10_000 }).toBe(2);
    const over = (await f.notices(bot.id))[1]!;
    expect(over).toContain("You've hit this week's $0.05. I finished the step I was on");
    expect(over).toContain("These routines will skip until the reset (1): Morning digest.");
    expect(over).toContain("Basic chat still works in Saver mode.");
    const report = (await f.api("GET", "/api/usage/allowance")).body;
    expect(report).toMatchObject({ level: "over", spentUsd: 0.05, saver: false, skipped: [{ name: "Morning digest" }] });

    // a new task waits, with the reset time; nothing is spent
    const refused = await f.api("POST", `/api/bots/${bot.id}/messages`, { text: "question 6" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/^You've hit this week's \$0\.05, so new tasks wait until Monday/);
    expect(f.usageRows()).toHaveLength(5);

    // a routine run waits too, quietly: no failure alert
    const held = await f.runNow(daily.body.routine.id);
    expect(held).toMatchObject({ status: "missed" });
    expect(held.error).toMatch(/^Not started: this week's allowance is used up\./);
    expect((await f.routineOf(daily.body.routine.id)).strip.map((entry: any) => entry.outcome)).toEqual(["missed"]);

    // Saver mode is the person's choice; then chat works again
    expect((await f.api("POST", "/api/usage/allowance/saver", { on: true })).body).toMatchObject({ saver: true });
    await turn("question 7");
    // the person's turn ran on the quick model
    expect(f.usageRows()[5]).toMatchObject({ model: expect.stringMatching(/haiku/), trigger: { kind: "owner" } });
    expect((await f.api("GET", "/api/usage/allowance")).body).toMatchObject({ level: "over", spentUsd: 0.05, overrunUsd: 0 });
    await expect.poll(async () => (await f.api("GET", "/api/usage/allowance")).body.saverUsd, { timeout: 10_000 }).toBeGreaterThanOrEqual(0.01);

    // adding to the week at the price shown lifts the hold
    expect((await f.api("POST", "/api/usage/allowance/top-up", { usd: 0.05 })).body).toMatchObject({ limitUsd: 0.1, level: "ok", extraUsd: 0.05 });
  }, 240_000);
});
