// A conversation another AI carries on while its own AI is at its limit, signed out or not answering: the model that
// answers now, a quiet line saying why, and its own model again once the limit has reset (the server moves it back
// before the next message).
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { engineName, resetTime } from "@/lib/limit-resets";
import type { Bot, ModelSelection } from "@/state/store";

export interface ThreadBackup {
  from: ModelSelection;
  to: ModelSelection;
  until: number | null;
  why?: "signed-out" | "provider";
}

export function threadBackup(bot: Bot, threadId: string | undefined, now = Date.now()): ThreadBackup | null {
  const task = bot.tasks?.find((candidate) => candidate.threadId === (threadId ?? bot.threadId));
  if (!task?.backup || !task.modelSelection) return null;
  if (task.backup.until !== null && task.backup.until <= now) return null;
  return { ...task.backup, to: task.modelSelection };
}

/** The model the conversation's next message goes to: the backup while it carries on, its own once the limit reset. */
export function answeringModel(bot: Bot, threadId: string | undefined, shown: ModelSelection, now = Date.now()): ModelSelection {
  const task = bot.tasks?.find((candidate) => candidate.threadId === (threadId ?? bot.threadId));
  if (!task?.backup || !task.modelSelection) return shown;
  return threadBackup(bot, threadId, now) ? task.modelSelection : task.backup.from;
}

export function backupLine(backup: ThreadBackup, now = Date.now()): string {
  const engine = engineName(backup.from.instanceId);
  if (backup.why === "signed-out") return t("model.backup.signedOut", { engine });
  if (backup.until !== null) return t("model.backup.until", { time: resetTime(backup.until, now) });
  return t("model.backup.limit", { engine });
}

export function backupTitle(backup: ThreadBackup, backupName: string, now = Date.now()): string {
  const engine = engineName(backup.from.instanceId);
  if (backup.why === "signed-out") return t("model.backup.signedOutTitle", { engine, backup: backupName });
  if (backup.why === "provider") return t("model.backup.providerTitle", { engine, backup: backupName });
  return backup.until !== null ? t("model.backup.untilTitle", { engine, backup: backupName, time: resetTime(backup.until, now) })
    : t("model.backup.limitTitle", { engine, backup: backupName });
}

export function useThreadBackup(bot: Bot, threadId: string | undefined): ThreadBackup | null {
  const [now, setNow] = useState(() => Date.now());
  const task = bot.tasks?.find((candidate) => candidate.threadId === (threadId ?? bot.threadId));
  const until = task?.backup?.until ?? null;
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    // setTimeout overflows past 2^31-1 ms
    const timer = setTimeout(() => setNow(Date.now()), Math.min(until - Date.now() + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [until]);
  return threadBackup(bot, threadId, Math.max(now, Date.now()));
}
