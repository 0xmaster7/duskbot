import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ api: vi.fn(), runBotMove: vi.fn() }));
vi.mock("@/state/store", () => ({ api: f.api }));
vi.mock("./bot-move", () => ({
  movable: (plan: { apps: Array<{ preview: { plans: unknown[] } }> }) => plan.apps.reduce((n, app) => n + app.preview.plans.length, 0),
  runBotMove: f.runBotMove,
  planCounts: (app: { preview: { plans: Array<{ counts?: object }> } }) => ({ bots: app.preview.plans.length, skills: 0, routines: 0, memories: 0, facts: 0, ...app.preview.plans[0]?.counts }),
}));
import { setLocale } from "@/lib/i18n";
import type { SetupDetection } from "../../shared/setup-import";
import type { AppMove, BotMovePlan } from "./bot-move";
import { bringChosen, bringRunNow, localFinds, memoryLine, resetBringRunForTests } from "./first-run-import";

const app = (name: string, bots: string[]): AppMove => ({
  app: name, where: "~/.openclaw", from: { name, key: name.toLowerCase() }, channels: [], unreadable: [],
  preview: { plans: bots.map((addedAs) => ({ addedAs })) as never, moved: [], unreadable: [] },
});
const plan = (...apps: AppMove[]): BotMovePlan => ({ apps, grokWaiting: [] });
const DETECTION: SetupDetection = {
  skills: [{ name: "pdf", source: "claudeCode" }, { name: "review", source: "claudeCode" }, { name: "lint", source: "codex" }],
  tools: [{ name: "notion", source: "cursor" }, { name: "github", source: "claudeCode" }],
  memory: [{ source: "claudeCode", files: 3, notes: 12 }],
};

beforeEach(() => {
  setLocale("en");
  resetBringRunForTests();
  f.api.mockReset();
  f.runBotMove.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("the first run's list of what this Mac holds", () => {
  it("lists only what has real content, Claude first, and keeps a few skills or tools as extras that come in with the rest", () => {
    const finds = localFinds(plan(app("OpenClaw", ["Atlas", "Juno"])), DETECTION);
    expect(finds.map((find) => [find.id, find.app, find.summary, Boolean(find.extra), Boolean(find.lead)])).toEqual([
      ["setup:claudeCode", "Claude Code", "12 notes, 2 skills, and 1 tool", false, true],
      ["bots:openclaw", "OpenClaw", "2 bots: Atlas and Juno", false, false],
      ["setup:codex", "Codex", "1 skill", true, false],
      ["setup:cursor", "Cursor", "1 tool", true, false],
    ]);
  });

  it("leads with Claude, then Hermes Agent and OpenClaw, keeps a tool whose agents became bots to one row, and leaves Grok Bot to its prompt", () => {
    const hermes = app("Hermes Agent", ["Hermes", "Coder"]);
    (hermes.preview.plans[0] as unknown as { counts: object }).counts = { skills: 3, routines: 2, memories: 4, facts: 2 };
    const claude = app("Claude Code", ["Code Reviewer"]);
    const grok = { ...app("Grok Bot", ["Desk"]), from: { name: "Grok Bot", key: "grok-bot" } };
    const finds = localFinds(plan(app("OpenClaw", ["Atlas"]), hermes, claude, grok), DETECTION);
    expect(finds.map((find) => [find.id, find.summary, find.source ?? null])).toEqual([
      ["bots:claude code", "1 bot: Code Reviewer. 12 notes, 2 skills, and 1 tool", "claudeCode"],
      ["bots:hermes agent", "2 bots: Hermes and Coder. 3 skills, 2 paused routines, 4 memories, and 2 things about you", null],
      ["bots:openclaw", "1 bot: Atlas", null],
      ["setup:codex", "1 skill", "codex"],
      ["setup:cursor", "1 tool", "cursor"],
    ]);
    expect(localFinds(plan(grok), DETECTION, { grokExports: true }).map((find) => find.id), "Settings, which may read Downloads, lists Grok bot's saved files")
      .toContain("bots:grok-bot");
  });

  it("is empty when nothing is here, and leaves out an app whose bots are all here already", () => {
    expect(localFinds(plan(app("Hermes Agent", [])), { skills: [], tools: [] })).toEqual([]);
    expect(localFinds(null, null)).toEqual([]);
  });
});

describe("bringing the chosen in", () => {
  it("asks for only the chosen tools' things and their memory for the first bot, moves the bots, and says so in one line", async () => {
    const apply = vi.fn(async () => ({
      skills: { added: ["pdf", "review"], present: [], skipped: [], filesLeftOut: 0, review: [] },
      tools: { added: ["github"], present: [], skipped: [] },
      memory: { added: 12, sources: ["claudeCode" as const], failed: false },
    }));
    f.api.mockResolvedValue({ ok: true });
    f.runBotMove.mockResolvedValue([{ app: {}, report: { bots: [{ id: "a", memories: 0, notes: 0 }, { id: "b", memories: 0, notes: 0 }], moved: [], unreadable: [], failed: [] } }]);
    const finds = localFinds(plan(app("OpenClaw", ["Atlas", "Juno"])), DETECTION).filter((find) => find.id !== "setup:cursor" && find.id !== "setup:codex");
    const run = bringChosen(finds, { dispatch: vi.fn(), firstBotId: "dusk", client: { detect: vi.fn(), apply }, memory: true });
    expect(bringRunNow()).toEqual({ kind: "working", ids: finds.map((find) => find.id), brought: [] });
    await run;
    expect(apply).toHaveBeenCalledExactlyOnceWith({ skills: true, tools: true, sources: ["claudeCode"], memory: true, memoryBot: "dusk" });
    expect(f.runBotMove).toHaveBeenCalledOnce();
    expect(bringRunNow()).toEqual({ kind: "done", failed: false, line: "Brought in 2 bots, 2 skills, 1 tool, and 12 notes.", brought: finds.map((find) => find.id) });
    await vi.waitFor(() => expect(f.api).toHaveBeenCalledWith("/api/bots/dusk/import-note", expect.anything()));
    const note = JSON.parse(f.api.mock.calls.find(([path]) => path === "/api/bots/dusk/import-note")![1].body);
    expect(note).toMatchObject({ from: ["Claude Code", "OpenClaw"], skills: 2, tools: 1, memories: 12, instructions: ["Claude Code"], failed: false });
  });

  it("leaves the memory out when it is unticked, and says what it holds per tool", async () => {
    const apply = vi.fn(async () => ({ skills: { added: [], present: [], skipped: [], filesLeftOut: 0, review: [] }, tools: { added: [], present: [], skipped: [] } }));
    const finds = localFinds(null, { ...DETECTION, memory: [{ source: "claudeCode", files: 3, notes: 12 }, { source: "codex", files: 1, notes: 1 }] });
    expect(memoryLine(finds)).toBe("12 notes from Claude Code and 1 note from Codex");
    await bringChosen(finds, { dispatch: vi.fn(), firstBotId: "dusk", client: { detect: vi.fn(), apply }, memory: false });
    expect(apply).toHaveBeenCalledExactlyOnceWith({ skills: true, tools: true, sources: ["claudeCode", "codex", "cursor"] });
  });

  it("names a failure and keeps what did come in", async () => {
    const apply = vi.fn(async () => { throw new Error("offline"); });
    f.runBotMove.mockResolvedValue([{ app: {}, report: { bots: [{ id: "a" }], moved: [], unreadable: [], failed: [] } }]);
    await bringChosen(localFinds(plan(app("OpenClaw", ["Atlas"])), DETECTION), { dispatch: vi.fn(), firstBotId: null, client: { detect: vi.fn(), apply } });
    expect(bringRunNow()).toMatchObject({ kind: "done", failed: true, line: "Brought in 1 bot. Some of it couldn't come in. Try again from settings → general → import." });
    expect(bringRunNow(), "a failed find stays one to import again").toMatchObject({ brought: [] });
  });

  it("brings one app in on its own Import, and remembers it alongside the next", async () => {
    const apply = vi.fn(async () => ({ skills: { added: ["pdf"], present: [], skipped: [], filesLeftOut: 0, review: [] }, tools: { added: [], present: [], skipped: [] } }));
    f.api.mockResolvedValue({ ok: true });
    f.runBotMove.mockResolvedValue([{ app: {}, report: { bots: [{ id: "a" }], moved: [], unreadable: [], failed: [] } }]);
    const finds = localFinds(plan(app("OpenClaw", ["Atlas"])), DETECTION);
    const openclaw = finds.find((find) => find.id === "bots:openclaw")!;
    await bringChosen([openclaw], { dispatch: vi.fn(), firstBotId: null, client: { detect: vi.fn(), apply } });
    expect(apply, "only that app").not.toHaveBeenCalled();
    expect(bringRunNow()).toMatchObject({ kind: "done", brought: ["bots:openclaw"] });
    await bringChosen([finds[0]!], { dispatch: vi.fn(), firstBotId: null, client: { detect: vi.fn(), apply } });
    expect(bringRunNow()).toMatchObject({ kind: "done", brought: ["bots:openclaw", finds[0]!.id] });
  });
});

