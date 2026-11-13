import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ api: vi.fn(), runBotMove: vi.fn() }));
vi.mock("@/state/store", () => ({ api: f.api }));
vi.mock("./bot-move", () => ({
  movable: (plan: { apps: Array<{ preview: { plans: unknown[] } }> }) => plan.apps.reduce((n, app) => n + app.preview.plans.length, 0),
  runBotMove: f.runBotMove,
}));
import { setLocale } from "@/lib/i18n";
import type { SetupDetection } from "../../shared/setup-import";
import type { AppMove, BotMovePlan } from "./bot-move";
import { bringChosen, bringRunNow, localFinds, resetBringRunForTests } from "./first-run-import";

const app = (name: string, bots: string[]): AppMove => ({
  app: name, where: "~/.openclaw", from: { name, key: name.toLowerCase() }, channels: [], unreadable: [],
  preview: { plans: bots.map((addedAs) => ({ addedAs })) as never, moved: [], unreadable: [] },
});
const plan = (...apps: AppMove[]): BotMovePlan => ({ apps, grokWaiting: [] });
const DETECTION: SetupDetection = {
  skills: [{ name: "pdf", source: "claudeCode" }, { name: "review", source: "claudeCode" }, { name: "lint", source: "codex" }],
  tools: [{ name: "notion", source: "cursor" }, { name: "github", source: "claudeCode" }],
  instructions: [{ name: "CLAUDE.md", source: "claudeCode" }],
};

beforeEach(() => {
  setLocale("en");
  resetBringRunForTests();
  f.api.mockReset();
  f.runBotMove.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("the first run's list of what this Mac holds", () => {
  it("lists bots first, then each AI tool once with everything new in it, in counts", () => {
    const finds = localFinds(plan(app("OpenClaw", ["Atlas", "Juno"])), DETECTION);
    expect(finds.map((find) => [find.id, find.app, find.summary])).toEqual([
      ["bots:openclaw", "OpenClaw", "2 bots: Atlas and Juno"],
      ["setup:claudeCode", "Claude Code", "2 skills, 1 tool, and your instructions"],
      ["setup:codex", "Codex", "1 skill"],
      ["setup:cursor", "Cursor", "1 tool"],
    ]);
  });

  it("is empty when nothing is here, and leaves out an app whose bots are all here already", () => {
    expect(localFinds(plan(app("Hermes Agent", [])), { skills: [], tools: [] })).toEqual([]);
    expect(localFinds(null, null)).toEqual([]);
  });
});

describe("bringing the chosen in", () => {
  it("asks for only the chosen tools' things, keeps instructions in the first bot's memory, moves the bots, and says so in one line", async () => {
    const apply = vi.fn(async () => ({
      skills: { added: ["pdf", "review"], present: [], skipped: [], filesLeftOut: 0, review: [] },
      tools: { added: ["github"], present: [], skipped: [] },
      instructions: [{ name: "CLAUDE.md", source: "claudeCode" as const, text: "Use pnpm." }],
    }));
    f.api.mockResolvedValue({ ok: true });
    f.runBotMove.mockResolvedValue([{ app: {}, report: { bots: [{ id: "a" }, { id: "b" }], moved: [], unreadable: [], failed: [] } }]);
    const finds = localFinds(plan(app("OpenClaw", ["Atlas", "Juno"])), DETECTION).filter((find) => find.id !== "setup:cursor" && find.id !== "setup:codex");
    const run = bringChosen(finds, { dispatch: vi.fn(), firstBotId: "dusk", client: { detect: vi.fn(), apply } });
    expect(bringRunNow()).toEqual({ kind: "working" });
    await run;
    expect(apply).toHaveBeenCalledExactlyOnceWith({ skills: true, tools: true, instructions: true, sources: ["claudeCode"] });
    const memory = f.api.mock.calls.find(([path]) => path === "/api/bots/dusk/memory/file")!;
    expect(JSON.parse(memory[1].body)).toMatchObject({ path: "memory/instructions-from-claude-code.md" });
    expect(JSON.parse(memory[1].body).text).toContain("Use pnpm.");
    expect(f.runBotMove).toHaveBeenCalledOnce();
    expect(bringRunNow()).toEqual({ kind: "done", failed: false, line: "Brought in 2 bots, 2 skills, 1 tool, and your instructions." });
  });

  it("names a failure and keeps what did come in", async () => {
    const apply = vi.fn(async () => { throw new Error("offline"); });
    f.runBotMove.mockResolvedValue([{ app: {}, report: { bots: [{ id: "a" }], moved: [], unreadable: [], failed: [] } }]);
    await bringChosen(localFinds(plan(app("OpenClaw", ["Atlas"])), DETECTION), { dispatch: vi.fn(), firstBotId: null, client: { detect: vi.fn(), apply } });
    expect(bringRunNow()).toMatchObject({ kind: "done", failed: true, line: "Brought in 1 bot. Some of it couldn't come in. Try again from settings → general → import." });
  });
});

