import { describe, expect, it } from "vitest";
import type { UsageReport, UsageTurn } from "../../../../shared/usage-signals.ts";
import { createUsage, latencyBucket, memoryUsageStore } from "./usage.ts";
import { focusRules, summarize, themesOf, type UsageAnswer } from "./usage-summary.ts";
import { dayOf } from "./events.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
let n = 0;
const turn = (patch: Partial<UsageTurn> = {}): UsageTurn => ({ id: `turn${String(++n).padStart(6, "0")}`, at: NOW - 3_600_000, engine: "claude", outcome: "ok", ms: 8000, tools: [], apps: [],
  category: "chat", from: "app", place: "desktop", room: false, ...patch });
const report = (patch: Partial<UsageReport>): UsageReport => ({ turns: [], runs: [], ...patch });

function setup(options: { optedOut?: string[]; noSummaries?: string[] } = {}) {
  const store = memoryUsageStore(() => NOW), problems: string[] = [];
  const usage = createUsage({ store, now: () => NOW, optedOut: id => options.optedOut?.includes(id) ?? false, summariesOff: id => options.noSummaries?.includes(id) ?? false,
    newProblem: group => problems.push(group.key) });
  return { usage, store, problems };
}

describe("usage rollups", () => {
  it("counts each record once, even when a report arrives twice", async () => {
    const { usage, store } = setup();
    const r = report({ turns: [turn({ apps: ["gmail"], tools: ["app"], category: "email", outcome: "failed", reason: "auth" }), turn({ tools: ["browser"], category: "research" })],
      runs: [{ id: "run0000001", at: NOW - 1000, trigger: "schedule", outcome: "ok" }] });
    await usage.ingest("acct_a", "ws_1", r);
    await usage.ingest("acct_a", "ws_1", r);
    const [row] = await store.daily(dayOf(NOW), dayOf(NOW));
    expect(row!.c).toMatchObject({ turns: 2, ok: 1, failed: 1, "engine:claude": 2, "engine_fail:claude": 1, "category:email": 1, "category:research": 1, "app:gmail": 1, "app_fail:gmail": 1,
      "reason_app:gmail:auth": 1, "tool:browser": 1, runs: 1, "run:schedule": 1, people: 1 });
    expect(await store.people(dayOf(NOW), dayOf(NOW))).toEqual([{ day: dayOf(NOW), accountId: "acct_a", turns: 2, failed: 1, runs: 1, frustrations: 0 }]);
  });

  it("counts a second workspace's record with the same id on its own", async () => {
    const { usage, store } = setup();
    const t = turn();
    await usage.ingest("acct_a", "ws_1", report({ turns: [t] }));
    await usage.ingest("acct_a", "ws_2", report({ turns: [t] }));
    expect((await store.daily(dayOf(NOW), dayOf(NOW)))[0]!.c.turns).toBe(2);
  });

  it("drops an opted-out or unclaimed workspace, and summaries when they are off", async () => {
    const { usage, store, problems } = setup({ optedOut: ["acct_out"], noSummaries: ["acct_quiet"] });
    await usage.ingest("acct_out", "ws_1", report({ turns: [turn()] }));
    await usage.ingest(null, "ws_2", report({ turns: [turn()] }));
    expect(await store.daily(dayOf(NOW), dayOf(NOW))).toEqual([]);
    const f = { id: "frust00001", at: NOW - 1000, engine: "claude" as const, category: "email" as const, tools: ["app" as const], apps: ["gmail"], signals: ["retried" as const], retries: 2, summary: "bot kept failing in the email app." };
    await usage.ingest("acct_quiet", "ws_3", report({ frustrations: [f], digests: [{ id: "digest0001", at: NOW - 1000, turns: 40, days: 4, summary: "they use it for email." }] }));
    const [stored] = await store.records("frustration", 0, NOW + 1, 10);
    expect((stored!.data as { summary?: string }).summary).toBeUndefined();
    expect(await store.records("digest", 0, NOW + 1, 10)).toEqual([]);
    expect(problems).toEqual(["claude|email|gmail"]);
    await usage.ingest("acct_b", "ws_4", report({ frustrations: [{ ...f, id: "frust00002" }] }));
    expect(problems).toHaveLength(1);
  });

  it("forgets an account's records", async () => {
    const { usage, store } = setup();
    await usage.ingest("acct_a", "ws_1", report({ turns: [turn()], snapshot: { bots: 2, rooms: 0, routines: 1, webhooks: 0, appEvents: 0, skills: 0 } }));
    await usage.forget("acct_a");
    expect(await store.records("turn", 0, NOW + 1, 10)).toEqual([]);
    expect(await store.snapshots()).toEqual([]);
    expect(await store.people(dayOf(NOW), dayOf(NOW))).toEqual([]);
  });

  it("buckets turn time", () => {
    expect(latencyBucket(1500)).toBe(0);
    expect(latencyBucket(45_000)).toBe(5);
    expect(latencyBucket(3_600_000)).toBe(9);
  });
});

describe("usage answer and focus", () => {
  async function answerFor(reports: Array<[string, UsageReport]>, adoption = { accounts: 20, bot: 15, routine: 5, connector: 4, phone: 2, cloud: 1 }) {
    const { usage, store } = setup();
    for (const [account, r] of reports) await usage.ingest(account, `ws_${account}`, r);
    const days = [dayOf(NOW - 86_400_000), dayOf(NOW)];
    return summarize({ days, daily: await store.daily(days[0]!, days[1]!), previousDaily: [], people: await store.people(days[0]!, days[1]!), previousPeople: 0,
      snapshots: await store.snapshots(), frustrations: await store.records("frustration", 0, NOW + 1, 100), digests: await store.records("digest", 0, NOW + 1, 100), adoption });
  }

  it("ranks categories, apps and failures with plain reasons", async () => {
    const turns = [
      ...Array.from({ length: 30 }, (_, i) => turn({ apps: ["gmail"], tools: ["app"], category: "email", outcome: i < 6 ? "failed" : "ok", reason: i < 6 ? "auth" : undefined })),
      ...Array.from({ length: 10 }, () => turn({ tools: ["browser"], category: "research", ms: 200_000 })),
    ];
    const a = await answerFor([["acct_a", report({ turns })]]);
    expect(a.categories[0]).toMatchObject({ key: "email", turns: 30, failed: 6 });
    expect(a.apps[0]).toMatchObject({ key: "gmail", turns: 30 });
    expect(a.failures.find(row => row.kind === "app" && row.key === "gmail")).toMatchObject({ failed: 6, reason: "auth", reasonWords: "sign-in expired or was refused" });
    expect(a.totals).toMatchObject({ turns: 40, people: 1 });
    expect(a.focus[0]!.text).toBe("gmail is the #1 app, but 20% of its turns fail (mostly sign-in expired or was refused): fix that first.");
    expect(a.focus.length).toBeGreaterThanOrEqual(1);
    expect(a.focus.length).toBeLessThanOrEqual(5);
  });

  it("says when routines are made but rarely run twice, and where adoption drops", async () => {
    const snap = { bots: 1, rooms: 0, routines: 1, webhooks: 0, appEvents: 0, skills: 0 };
    const reports: Array<[string, UsageReport]> = ["a", "b", "c", "d", "e"].map((id, i) => [`acct_${id}`, report({ turns: [turn()], snapshot: snap,
      runs: i === 0 ? [{ id: "run0000001", at: NOW - 5000, trigger: "schedule", outcome: "ok" }, { id: "run0000002", at: NOW - 4000, trigger: "schedule", outcome: "ok" }] : [] })]);
    const a = await answerFor(reports);
    expect(a.routines).toMatchObject({ peopleWithRoutines: 5, peopleRan: 1, peopleRanTwice: 1 });
    const texts = a.focus.map(item => item.text);
    expect(texts).toContain("people make routines, but only 20% of them had one run twice: look at routine reliability.");
    expect(texts.some(text => text.includes('never get to "first routine"'))).toBe(true);
  });

  it("groups frustrations by problem and digests by theme, and feeds focus", async () => {
    const frustration = (i: number) => ({ id: `frust0000${i}`, at: NOW - 1000, engine: "codex" as const, category: "coding" as const, tools: ["terminal" as const], apps: [], signals: ["stopped" as const],
      retries: 0, summary: `the bot kept breaking the build while fixing a test, attempt ${"abc"[i]}.` });
    const digests = [0, 1, 2].map(i => ({ id: `digest000${i}`, at: NOW - 1000, turns: 40, days: 4, summary: i < 2 ? "they use it for email replies; slow replies are painful." : "mostly coding help." }));
    const a = await answerFor([["acct_a", report({ frustrations: [0, 1, 2].map(frustration), digests })]]);
    expect(a.frustration.groups[0]).toMatchObject({ key: "codex|coding|terminal", count: 3 });
    expect(a.frustration.groups[0]!.examples).toHaveLength(3);
    expect(a.themes.find(theme => theme.key === "email")).toMatchObject({ count: 2 });
    expect(a.focus.some(item => item.id === "problem:codex|coding|terminal")).toBe(true);
    expect(a.focus.some(item => item.id === "theme:slow")).toBe(true);
  });

  it("writes nothing for an empty window", () => {
    const empty = { totals: { turns: 0, failRate: null, p90Ms: null }, apps: [], failures: [], frustration: { groups: [] }, routines: { peopleWithRoutines: 0, runs: 0, failed: 0 },
      adoption: [], categories: [], themes: [], people: { topShare: null } } as unknown as UsageAnswer;
    expect(focusRules(empty)).toEqual([]);
    expect(themesOf([])).toEqual([]);
  });
});
