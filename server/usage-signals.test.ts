import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  USAGE_DIGEST_KEYS, USAGE_FRUSTRATION_KEYS, USAGE_RUN_KEYS, USAGE_TURN_KEYS, categorize, cleanUsageFrustration, cleanUsageReport, cleanUsageTurn, failureReason, scrubSummary, toolSignals,
  type UsageFrustration,
} from "../shared/usage-signals.ts";
import { parseWorkspaceReport } from "../shared/dashboard-protocol.ts";
import {
  MIN_WORKSPACE_TURNS, createFrustrationWatch, createUsageOutbox, digestPrompt, isCorrective, isShouting, isSwearing, sameRequest, turnRecord, weeklyAllowance, type FrustrationTurn,
} from "./usage-signals.ts";

const NOW = Date.now();
const SECRET = "Email jane.doe@acme.com the Q3 numbers from /Users/jane/Secret Plan.xlsx at https://acme.com/x";
const allStrings = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(allStrings) : value && typeof value === "object" ? Object.values(value).flatMap(allStrings) : [];

describe("categorize", () => {
  it("lets a connected app decide, then the tools, then plain chat", () => {
    expect(categorize({ tools: ["app", "browser"], apps: ["gmail"] })).toBe("email");
    expect(categorize({ tools: ["app"], apps: ["googlecalendar", "slack"] })).toBe("calendar");
    expect(categorize({ tools: ["terminal", "files"], apps: [] })).toBe("coding");
    expect(categorize({ tools: ["browser", "web"], apps: [] })).toBe("research");
    expect(categorize({ tools: ["files"], apps: [] })).toBe("files");
    expect(categorize({ tools: ["data"], apps: [] })).toBe("data");
    expect(categorize({ tools: ["memory"], apps: [] })).toBe("chat");
    expect(categorize({ tools: [], apps: [] })).toBe("chat");
  });

  it("folds tool names into kinds and only curated app slugs", () => {
    expect(toolSignals(["Bash", "mcp__composio__GMAIL_SEND_EMAIL", "mcp__composio__ACMECRM_LIST", "WebSearch", "mcp__browser__navigate"])).toEqual({
      tools: ["app", "browser", "terminal", "web"], apps: ["gmail", "other_app"],
    });
  });

  it("turns an error line into a code and never keeps the line", () => {
    expect(failureReason("429 Too Many Requests for org acme")).toBe("rate_limit");
    expect(failureReason("You've hit your usage limit")).toBe("quota");
    expect(failureReason("OAuth token expired for jane@acme.com")).toBe("auth");
    expect(failureReason("request timed out after 600s")).toBe("timeout");
    expect(failureReason("something odd")).toBe("unknown");
  });
});

describe("what leaves the workspace", () => {
  it("a turn record carries only its fixed keys, and no text from the turn", () => {
    const record = turnRecord({ driverKind: "claudeAgent", status: "error", reason: SECRET, startedAt: NOW - 5000, endedAt: NOW, toolNames: ["mcp__composio__GMAIL_SEND_EMAIL", `Read ${SECRET}`],
      trigger: { kind: "user" }, room: false }, "desktop", NOW)!;
    expect(Object.keys(record).every(key => (USAGE_TURN_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(record).toMatchObject({ engine: "claude", outcome: "failed", reason: "unknown", ms: 5000, category: "email", from: "remote", place: "desktop", apps: ["gmail"] });
    for (const text of allStrings(record)) expect(text).toMatch(/^[a-z0-9_-]+$/i);
  });

  it("drops unknown keys and bad values on both sides", () => {
    const turn = cleanUsageTurn({ id: "abcdefgh12", at: NOW, engine: "claude", outcome: "ok", ms: 10, tools: ["browser", "evil"], apps: ["gmail", "acme.com"], category: "research", from: "app",
      place: "cloud", room: false, prompt: SECRET, text: SECRET }, NOW)!;
    expect(Object.keys(turn).sort()).toEqual(["apps", "at", "category", "engine", "from", "id", "ms", "outcome", "place", "room", "tools"]);
    expect(turn.apps).toEqual(["gmail"]);
    expect(cleanUsageTurn({ ...turn, engine: "my-secret-instance" }, NOW)).toBeNull();
  });

  it("the report section passes the dashboard parser with nothing but allowed keys", () => {
    const outbox = createUsageOutbox({ now: () => NOW, snapshot: () => ({ bots: 3, rooms: 1, routines: 2, webhooks: 0, appEvents: 1, skills: 4 }) });
    outbox.turn(turnRecord({ driverKind: "codex", status: "ok", toolNames: ["shell"], trigger: { kind: "owner" }, room: true, startedAt: NOW - 100, endedAt: NOW }, "desktop", NOW));
    outbox.run({ id: "run_1", status: "failed", triggerSource: "webhook", eventSource: "app", error: SECRET, finishedAt: NOW });
    outbox.frustration(cleanUsageFrustration({ id: "frustrate1", at: NOW, engine: "claude", category: "email", tools: ["app"], apps: ["gmail"], signals: ["retried"], retries: 2,
      summary: "bot kept failing to draft a reply in the email app; the person retried and gave up." }, NOW));
    const usage = outbox.take()!;
    const parsed = parseWorkspaceReport({ v: 1, seq: 1, at: NOW, workspace: { name: "w", kind: "mac", version: "1", platform: "darwin" }, usage })!;
    expect(parsed.usage).toEqual(usage);
    for (const turn of usage.turns) expect(Object.keys(turn).every(key => (USAGE_TURN_KEYS as readonly string[]).includes(key))).toBe(true);
    for (const run of usage.runs) expect(Object.keys(run).every(key => (USAGE_RUN_KEYS as readonly string[]).includes(key))).toBe(true);
    for (const f of usage.frustrations ?? []) expect(Object.keys(f).every(key => (USAGE_FRUSTRATION_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(usage.runs[0]).toMatchObject({ trigger: "event", outcome: "failed", reason: "unknown" });
    expect(JSON.stringify(usage)).not.toMatch(/jane|acme|xlsx|https/i);
    expect(outbox.take()).toMatchObject({ turns: [], runs: [] });
  });

  it("puts a failed report back and sends nothing while switched off", () => {
    let on = true;
    const outbox = createUsageOutbox({ now: () => NOW, enabled: () => on });
    outbox.turn(turnRecord({ driverKind: "codex", status: "ok", toolNames: [], trigger: { kind: "owner" }, room: false }, "desktop", NOW));
    const taken = outbox.take()!;
    outbox.requeue(taken);
    expect(outbox.size().turns).toBe(1);
    on = false;
    expect(outbox.take()).toBeNull();
    outbox.turn(turnRecord({ driverKind: "codex", status: "ok", toolNames: [], trigger: { kind: "owner" }, room: false }, "desktop", NOW));
    expect(outbox.size().turns).toBe(0);
  });
});

describe("scrubSummary", () => {
  it("keeps an abstract line and lowercases it", () => {
    expect(scrubSummary("Bot kept failing to draft a reply in the email app; user retried and gave up.")).toBe("bot kept failing to draft a reply in the email app; user retried and gave up.");
    expect(scrubSummary("user asked the bot to reconcile last month's receipts into a spreadsheet; it couldn't open the sheet.")).toContain("last month's receipts");
  });
  it("takes out addresses, links, handles, numbers, quotes, files and names", () => {
    const out = scrubSummary("The bot could not send the weekly summary to the team lead even after retrying, and the person was annoyed; it failed with Gmail at https://x.io for @sam on 12/3 in plan.xlsx")!;
    expect(out).not.toMatch(/gmail|https|x\.io|@sam|12|xlsx/);
  });
  it("drops a summary that was mostly personal details", () => {
    expect(scrubSummary("Jane Doe jane@acme.com +1 415 555 0100 Acme Corp")).toBeNull();
    expect(scrubSummary('he said "send the contract to Bob at Acme now please" twice')).toBeNull();
  });
  it("is stable: a scrubbed line passes the server's check unchanged", () => {
    const once = scrubSummary("The bot kept timing out while reading a long document, and the person stopped it twice.")!;
    expect(scrubSummary(once)).toBe(once);
    const record = cleanUsageFrustration({ id: "frustrate1", at: NOW, engine: "claude", category: "files", tools: [], apps: [], signals: ["stopped"], retries: 0, summary: once }, NOW)!;
    expect(record.summary).toBe(once);
    expect(cleanUsageFrustration({ ...record, summary: "Sent to Bob" }, NOW)!.summary).toBeUndefined();
  });
});

describe("frustration watch", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const turn = (outcome: FrustrationTurn["outcome"] = "ok"): FrustrationTurn => ({ engine: "claude", category: "email", tools: ["app"], apps: ["gmail"], outcome });
  function setup(options: { summary?: string } = {}) {
    let now = NOW;
    const reports: UsageFrustration[] = [], prompts: string[] = [];
    const dataDir = mkdtempSync(join(tmpdir(), "frustration-")); dirs.push(dataDir);
    const watch = createFrustrationWatch({ dataDir, now: () => now, report: record => reports.push(record), summarize: async input => { prompts.push(input.signals.join(",")); return options.summary ?? null; } });
    const warm = (turns = MIN_WORKSPACE_TURNS) => { for (let i = 0; i < turns; i++) watch.turn("warmup", "bot_1", turn()); };
    return { watch, reports, prompts, warm, tick: (ms: number) => { now += ms; }, dataDir };
  }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it("spots corrections, swearing, shouting and repeats in a few languages", () => {
    expect(isCorrective("no, that's wrong")).toBe(true);
    expect(isCorrective("nein")).toBe(true);
    expect(isCorrective("not what i asked")).toBe(true);
    expect(isCorrective("no worries, thanks a lot for the help with everything today")).toBe(false);
    expect(isSwearing("this is fucking stupid")).toBe(true);
    expect(isSwearing("are you dumb")).toBe(true);
    expect(isSwearing("please summarise the article")).toBe(false);
    expect(isShouting("WHY DOES THIS NEVER WORK")).toBe(true);
    expect(isShouting("check the AWS bill")).toBe(false);
    expect(sameRequest("draft a reply to the landlord about the leak", "please draft the reply to my landlord about that leak")).toBe(true);
    expect(sameRequest("draft a reply to the landlord", "what's the weather tomorrow")).toBe(false);
  });

  it("needs several signals: one swear alone is not enough", async () => {
    const { watch, reports, warm } = setup();
    warm();
    for (let i = 0; i < 3; i++) watch.turn("chat", "bot_1", turn());
    watch.message("chat", "ugh this is stupid");
    await flush();
    expect(reports).toHaveLength(0);
    watch.thumbsDown("chat");
    await flush();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.signals).toEqual(expect.arrayContaining(["thumbs_down", "swearing"]));
  });

  it("waits for real use before it fires", async () => {
    const { watch, reports } = setup();
    for (let i = 0; i < 3; i++) watch.turn("chat", "bot_1", turn("cancelled"));
    watch.thumbsDown("chat");
    await flush();
    expect(reports).toHaveLength(0);
  });

  it("fires on retries and stops, once per chat per cooldown, with a scrubbed summary and no raw text", async () => {
    const { watch, reports, warm, tick } = setup({ summary: "Bot kept failing to send a reply in the email app; user retried and gave up. Contact jane@acme.com" });
    warm(80);
    for (let i = 0; i < 3; i++) watch.turn("chat", "bot_1", turn("failed"));
    watch.message("chat", "send the reply to my landlord about the leak");
    watch.message("chat", "please send that reply to my landlord about the leak");
    watch.message("chat", "SEND THE REPLY TO MY LANDLORD ABOUT THE LEAK");
    await flush();
    expect(reports).toHaveLength(1);
    const record = reports[0]!;
    expect(Object.keys(record).every(key => (USAGE_FRUSTRATION_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(record.retries).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(record)).not.toMatch(/landlord|leak|jane|acme/i);
    watch.thumbsDown("chat"); watch.turn("chat", "bot_1", turn("cancelled"));
    await flush();
    expect(reports).toHaveLength(1);
    tick(7 * 3_600_000);
    watch.thumbsDown("chat"); watch.turn("chat", "bot_1", turn("cancelled"));
    await flush();
    expect(reports).toHaveLength(2);
  });

  it("scales the weekly allowance with use", async () => {
    expect(weeklyAllowance(10)).toBe(1);
    expect(weeklyAllowance(200)).toBe(5);
    const { watch, reports, warm, tick } = setup();
    warm();
    for (let chat = 0; chat < 4; chat++) {
      for (let i = 0; i < 3; i++) watch.turn(`chat${chat}`, "bot_1", turn());
      watch.thumbsDown(`chat${chat}`); watch.turn(`chat${chat}`, "bot_1", turn("cancelled"));
      tick(60_000);
    }
    await flush();
    expect(reports).toHaveLength(1);
  });

  it("asks for a digest once a week from people who use it enough", () => {
    const { watch, tick } = setup();
    expect(watch.digestDue()).toBe(false);
    for (let day = 0; day < 4; day++) { for (let i = 0; i < 10; i++) watch.turn("chat", "bot_1", turn()); tick(86_400_000); }
    expect(watch.digestDue()).toBe(true);
    watch.digestSent();
    expect(watch.digestDue()).toBe(false);
    expect(digestPrompt([{ lines: [{ role: "user", text: "hi" }] }], { turns: 40, days: 4, categories: ["email"], tools: ["app"] })).toContain("at most 90 words");
  });

  it("a digest passes only when scrubbed, with its fixed keys", () => {
    const summary = scrubSummary("they mostly use it for email triage and drafting replies; slow replies and sign-in problems are painful; they want better calendar help.", 700)!;
    const parsed = cleanUsageReport({ turns: [], runs: [], digests: [{ id: "digest0001", at: NOW, turns: 40, days: 4, summary }, { id: "digest0002", at: NOW, turns: 40, days: 4, summary: "Mail Bob" }] }, NOW)!;
    expect(parsed.digests).toHaveLength(1);
    expect(Object.keys(parsed.digests![0]!).sort()).toEqual([...USAGE_DIGEST_KEYS].sort());
  });
});
