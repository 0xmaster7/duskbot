import { expect, it } from "vitest";

import type { Bot } from "@/state/store";
import { answeringModel, backupLine, threadBackup } from "./thread-backup";

const claude = { instanceId: "claude", model: "claude-sonnet-5" };
const codex = { instanceId: "codex", model: "gpt-6" };
const now = Date.UTC(2026, 10, 14, 12);
const bot = (backup?: { until: number | null; why?: "signed-out" }) => ({
  id: "b", threadId: "t", modelSelection: claude,
  tasks: [{ threadId: "t", title: "", createdAt: 0, modelSelection: backup ? codex : claude, ...(backup ? { backup: { from: claude, ...backup } } : {}) }],
}) as unknown as Bot;

it("answers on the backup until the reset, then on the conversation's own AI", () => {
  const onBackup = bot({ until: now + 60_000 });
  expect(answeringModel(onBackup, "t", claude, now)).toEqual(codex);
  expect(threadBackup(onBackup, "t", now)).toMatchObject({ from: claude, to: codex });
  expect(backupLine(threadBackup(onBackup, "t", now)!, now)).toMatch(/^Backup until /);
  expect(answeringModel(onBackup, "t", claude, now + 60_001)).toEqual(claude);
  expect(threadBackup(onBackup, "t", now + 60_001)).toBeNull();
});

it("keeps the shown model when the conversation has no takeover", () => {
  expect(answeringModel(bot(), "t", claude, now)).toEqual(claude);
  expect(threadBackup(bot(), "t", now)).toBeNull();
});

it("says why when no reset is known", () => {
  expect(backupLine(threadBackup(bot({ until: null, why: "signed-out" }), "t", now)!, now)).toMatch(/is signed out$/);
  expect(backupLine(threadBackup(bot({ until: null }), "t", now)!, now)).toMatch(/is at its limit$/);
});
