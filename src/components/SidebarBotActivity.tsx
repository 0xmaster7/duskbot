import { BellDot, CircleAlert, Clock3, Loader2, type GlyphIcon } from "../icons";
import type { Dispatch } from "react";
import type { Action, Bot, Group, Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { roomThreadSpeakerId, roomThreadWorking } from "@/lib/room-threads";
import { t } from "@/lib/i18n";
import { isArchived, orderedSidebarThreads, orderedThreadList } from "./SidebarThreadRow";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { localizedTaskTitle } from "@/lib/task-title";

export function sidebarBotActivityTasks(bot: Bot, queued: Record<string, unknown[]>, archivedApprovals = false): Array<Task & { queued: boolean }> {
  const tasks = bot.tasks ?? [{
    threadId: bot.threadId, title: t("task.newShort"), createdAt: 0,
    busy: bot.busy, activity: bot.activity, unread: bot.unread,
    waitingForTeammates: bot.waitingForTeammates,
  }];
  return tasks.map((task) => ({ ...task, queued: Boolean(queued[task.threadId]?.length) }))
    .filter((task) => !task.routineRunId)
    .filter((task) => !isArchived(task) || (archivedApprovals && task.activity === "waiting-on-you"))
    .filter((task) => task.activity === "waiting-on-you" || task.activity === "working" || task.busy || task.waitingForTeammates === true || task.queued || task.unread);
}

/** A routine run's thread stays out of the thread tree, but gets an activity row while it runs, so the person can open it and watch. */
export function runningRoutineRun(task: Task): boolean {
  return Boolean(task.routineRunId) && !isArchived(task) && (task.busy === true || task.activity === "working");
}

export function runningRoutineRuns(bot: Bot): Array<Task & { queued: boolean }> {
  return orderedThreadList((bot.tasks ?? []).filter(runningRoutineRun).map((task) => ({ ...task, queued: false })));
}

export function sidebarBotStatus(bot: Bot, queued: Record<string, unknown[]>) {
  const tasks = sidebarBotActivityTasks(bot, queued);
  const waiting = bot.activity === "waiting-on-you" || tasks.some((task) => task.activity === "waiting-on-you");
  const working = !waiting && (Boolean(bot.busy) || tasks.some((task) => task.busy || task.activity === "working"));
  const teammateWait = !waiting && !working && (Boolean(bot.waitingForTeammates) || tasks.some((task) => Boolean(task.waitingForTeammates)));
  return { waiting, working, teammateWait, queued: tasks.some((task) => task.queued) };
}

/** Must derive each thread's state exactly as GroupThreadList's sidebar rows do. */
export function sidebarGroupActivityTasks(group: Group, bots: Bot[], queued: Record<string, unknown[]>): Array<Task & { queued: boolean }> {
  if (group.dm) return [];
  const tasks = (group.tasks ?? [{ threadId: group.threadId, title: group.name, createdAt: group.createdAt }]).map((task) => {
    const speakerId = roomThreadSpeakerId(group, task.threadId);
    const waiting = Boolean(speakerId) && bots.find((bot) => bot.id === speakerId)?.activity === "waiting-on-you";
    return {
      ...task, busy: roomThreadWorking(group, task.threadId), unread: task.threadId === group.threadId && Boolean(group.unread),
      activity: waiting || task.activity === "waiting-on-you" ? "waiting-on-you" as const : undefined,
    };
  });
  return tasks.map((task) => ({ ...task, queued: Boolean(queued[task.threadId]?.length) }))
    .filter((task) => task.activity === "waiting-on-you" || task.busy || task.queued || task.unread);
}

export type AttentionThread =
  | { kind: "bot"; botId: string; botName: string; task: Task & { queued: boolean } }
  | { kind: "group"; groupId: string; groupName: string; groupThreadId: string; task: Task & { queued: boolean } };

export function attentionOwnerName(entry: AttentionThread): string {
  return entry.kind === "bot" ? entry.botName : entry.groupName;
}

export function attentionJumpAction(entry: AttentionThread):
  | { type: "switchTask"; botId: string; threadId: string }
  | { type: "switchGroupTask"; groupId: string; threadId: string }
  | { type: "select"; id: string } {
  if (entry.kind === "bot") return { type: "switchTask", botId: entry.botId, threadId: entry.task.threadId };
  return entry.task.threadId === entry.groupThreadId
    ? { type: "select", id: entry.groupId }
    : { type: "switchGroupTask", groupId: entry.groupId, threadId: entry.task.threadId };
}

export function attentionHasRunningWork(entries: readonly AttentionThread[]): boolean {
  return entries.some((entry) => entry.task.activity === "working" || (entry.task.busy === true && entry.task.activity !== "waiting-on-you") || entry.task.queued === true);
}

export function attentionRowStatus(task: AttentionThread["task"]): { active: boolean; Icon: GlyphIcon; colorClass: string; label: string } {
  const waiting = task.activity === "waiting-on-you";
  const teammateWait = !waiting && task.waitingForTeammates === true;
  const working = !waiting && !teammateWait && (task.busy || task.activity === "working");
  const active = waiting || teammateWait || working || task.queued || task.unread === true;
  const label = waiting ? t("task.waiting") : working ? t("chat.activity.working") : teammateWait ? t("task.waitingOnTeammate") : task.queued ? t("task.queued") : t("task.unread");
  const Icon = waiting ? CircleAlert : working ? Loader2 : teammateWait || task.queued ? Clock3 : BellDot;
  const colorClass = cn(working && "animate-spin text-success", (waiting || teammateWait) && "text-warning");
  return { active, Icon, colorClass, label };
}

type FlatAttentionEntry = Task & {
  queued: boolean; botId?: string; botName?: string; groupId?: string; groupName?: string; groupThreadId?: string;
};

export function crossBotAttentionThreads(
  bots: Bot[], queued: Record<string, unknown[]>, exceptBotId?: string, groups: Group[] = [],
): AttentionThread[] {
  const flat: FlatAttentionEntry[] = [
    ...bots
      .filter((bot) => bot.id !== exceptBotId && !bot.hidden)
      .flatMap((bot): FlatAttentionEntry[] => sidebarBotActivityTasks(bot, queued, true)
        .map((task) => ({ ...task, botId: bot.id, botName: bot.name }))),
    ...groups
      .flatMap((group): FlatAttentionEntry[] => sidebarGroupActivityTasks(group, bots, queued)
        .map((task) => ({ ...task, groupId: group.id, groupName: group.name, groupThreadId: group.threadId }))),
  ];
  return orderedSidebarThreads(flat, "").map(({ botId, botName, groupId, groupName, groupThreadId, ...task }): AttentionThread =>
    groupId !== undefined
      ? { kind: "group", groupId, groupName: groupName!, groupThreadId: groupThreadId!, task }
      : { kind: "bot", botId: botId!, botName: botName!, task });
}

const attentionOwnerKey = (entry: AttentionThread) => entry.kind === "bot" ? `bot:${entry.botId}` : `group:${entry.groupId}`;

/** One row per bot or room: entries arrive most urgent first, so each owner keeps its most urgent conversation. */
export function attentionByOwner(entries: readonly AttentionThread[]): AttentionThread[] {
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(attentionOwnerKey(entry)) && Boolean(seen.add(attentionOwnerKey(entry))));
}

export function AttentionThreadRows({ entries, onJump, inset = false }: { entries: AttentionThread[]; onJump: (entry: AttentionThread) => void; inset?: boolean }) {
  return <>
    {attentionByOwner(entries).map((entry) => {
      const { Icon, colorClass, label: status } = attentionRowStatus(entry.task);
      const name = attentionOwnerName(entry);
      const label = `${name} · ${status}`;
      return <button key={attentionOwnerKey(entry)} type="button" aria-label={label} title={label}
        onClick={() => onJump(entry)}
        className={cn("flex w-full items-center gap-2.5 text-left text-[13px] text-ink hover:bg-menu-hover", inset ? "rounded-md px-2 py-1.5" : "px-3.5 py-2")}>
        <Icon size={inset ? 16 : 15} aria-hidden="true" className={cn("shrink-0", colorClass)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          <span className="block truncate text-[11px] text-ink-secondary">{status}</span>
        </span>
      </button>;
    })}
  </>;
}

/** A running routine's row under its bot, so the person can open the run and watch. */
export function SidebarBotActivity({ bot, rowThreadId, density, dispatch }: { bot: Bot; rowThreadId: string; density: SidebarDensity; dispatch: Dispatch<Action> }) {
  const tasks = runningRoutineRuns(bot).filter((task) => task.threadId !== rowThreadId);
  if (!tasks.length) return null;
  const iconOnly = density === "icons";
  return <div data-sidebar-bot-activity={bot.id} className={cn("mb-1 space-y-0.5", !iconOnly && "ml-6")}>
    {tasks.map((task) => {
      const waiting = task.activity === "waiting-on-you";
      const teammateWait = !waiting && task.waitingForTeammates === true;
      const working = !waiting && !teammateWait && (task.busy || task.activity === "working");
      const status = waiting ? t("sidebar.preview.waiting") : working ? t("chat.activity.working") : teammateWait ? t("sidebar.preview.waitingOnTeammate") : task.queued ? t("task.queued") : t("task.unread");
      const title = localizedTaskTitle(task.title);
      const label = `${bot.name}: ${title} · ${status}${task.unread && (waiting || working || teammateWait || task.queued) ? ` · ${t("task.unread")}` : ""}`;
      const Icon = waiting ? CircleAlert : working ? Loader2 : teammateWait || task.queued ? Clock3 : BellDot;
      return <button key={task.threadId} type="button" data-sidebar-activity-row={task.threadId} aria-label={label} title={label}
        onClick={() => dispatch({ type: "switchTask", botId: bot.id, threadId: task.threadId })}
        className={cn("flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] outline-none hover:bg-raised/50 focus-visible:ring-1 focus-visible:ring-focus", iconOnly && "justify-center", waiting ? "text-warning" : "text-ink-secondary")}>
        <Icon size={12} aria-hidden="true" className={cn("shrink-0", working && "animate-spin text-success", teammateWait && "text-warning", task.unread && !waiting && !working && !teammateWait && "text-accent")} />
        {!iconOnly && <><span className="min-w-0 flex-1 truncate">{title}</span><span className="shrink-0 text-[10px]">{waiting ? t("task.waiting") : status}</span>
          {task.unread && (waiting || working || teammateWait || task.queued) && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}</>}
      </button>;
    })}
  </div>;
}
