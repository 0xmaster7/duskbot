import { approvalCardOutcome } from "./ApprovalCard";
import type { Bot, Group, InstanceInfo, Message } from "@/state/store";
import type { RoutineRunCardData } from "../../shared/routine-run";
import { peerLine } from "@/lib/peer-message";
import { isReceipt } from "@/lib/receipts";
import { activityPreview, botEngine, failedTurnCause, STATUS_MARKER } from "@/lib/failed-turn";
import { t } from "@/lib/i18n";
import { sidebarConnectorPreview, sidebarGoalRunPreview } from "@/lib/sidebar-layout";
import { withoutCitationMarkers } from "@/lib/citations";
import { plainPreviewText } from "@/lib/plain-preview";
import { isClientCancellation, isStoppedTurnName } from "../../shared/client-cancel";
import { roomWorkingPreview } from "@/lib/room-threads";
import { openPersonWait } from "../../shared/person-wait";

/** The newest message a preview can show. A receipt or a screen frame says nothing about the conversation on its own. */
export function lastPreviewable<T extends { kind: string }>(messages: readonly T[] | undefined): T | undefined {
  return messages?.findLast((message) => !isReceipt(message) && message.kind !== "screen");
}

export function sidebarPreviewMessages(owner: { messages: Message[]; previewMessages?: Message[]; transcriptLoaded?: boolean; transcriptStale?: boolean }): Message[] {
  if (!owner.previewMessages?.length) return owner.messages;
  if (owner.transcriptStale) {
    // a held transcript may predate the snapshot's preview: the newer of the two, by time, is the row's last line
    const known = new Set(owner.messages.map((message) => message.id));
    const newer = owner.previewMessages.filter((message) => !known.has(message.id));
    return newer.length ? [...owner.messages, ...newer].sort((a, b) => a.at - b.at) : owner.messages;
  }
  if (owner.transcriptLoaded !== false) return owner.messages;
  const rows = new Map(owner.previewMessages.map((message) => [message.id, message]));
  for (const message of owner.messages) rows.set(message.id, message);
  return [...rows.values()];
}

export function botPreview(bot: Bot, visible: Message[], instances: InstanceInfo[]): string {
  if (bot.activity === "waiting-on-you") return t("sidebar.preview.waiting");
  if (bot.waitingForTeammates) return t("sidebar.preview.waitingOnTeammate");
  if (bot.busy) return t("sidebar.preview.working");
  return lastLine(bot, visible, instances);
}

function plainStep(message: Message): boolean {
  const tool = message.kind === "activity" ? message.tool : undefined;
  return Boolean(tool) && !message.dataResult && failedTurnCause(tool!.name) === null && !isStoppedTurnName(tool!.name) && !STATUS_MARKER.test(tool!.name);
}

/** A preview quotes the bot: a step that went fine gives way to the newest thing said since the person last wrote. */
function quotedLine(messages: readonly Message[], last: Message): Message {
  if (!plainStep(last)) return last;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") break;
    if (message.kind !== "activity" && !isReceipt(message) && message.kind !== "screen") return message;
  }
  return last;
}

/** What a waiting row quotes: the open question itself, not a line the bot said after it. */
export function waitingLine(bot: Bot, visible: Message[], instances: InstanceInfo[]): string {
  const wait = openPersonWait(visible);
  return wait?.kind === "question" && wait.label.trim() ? plainPreviewText(wait.label) : lastLine(bot, visible, instances);
}

/** The conversation's newest line as a preview shows it, whatever the bot is doing now. */
export function lastLine(bot: Bot, visible: Message[], instances: InstanceInfo[]): string {
  const newest = lastPreviewable(visible);
  if (!newest) return "";
  const last = quotedLine(visible, newest);
  if (last.kind === "options" && last.card) {
    // MausBot's intro by its first line.
    if (last.helperIntro) return t(bot.chiefOfStaff ? "helperIntro.hello" : "helperIntro.hi.helper", { name: bot.name });
    return (last.card.requestId && last.card.tool && !last.card.questionRequest && approvalCardOutcome(last.card)) || last.card.title;
  }
  if (last.kind === "activity" && last.tool) return activityPreview(last.tool, botEngine(bot, instances), last.dataResult);
  if (last.kind === "connector" && last.connector) return sidebarConnectorPreview(last.connector, t);
  if (last.kind === "routine.run" && last.routineRun) return automationRunPreview(last.routineRun);
  const peer = peerLine(last);
  if (peer) return `${peer.name}: ${plainPreviewText(peer.body)}`;
  if (last.role !== "user" && isClientCancellation(last.text ?? "")) return t("chat.turnStopped");
  return plainPreviewText(withoutCitationMarkers(last.text ?? ""));
}

const RUN_PREVIEW = {
  completed: "automations.preview.finished", failed: "automations.preview.failed", waiting: "automations.preview.needsYou",
  cancelled: "automations.preview.stopped", missed: "automations.preview.missed", running: "automations.preview.running", queued: "automations.preview.running",
} as const satisfies Record<RoutineRunCardData["status"], string>;

/** "“Morning summary” finished": an automation's run, in the page's words. */
export function automationRunPreview(run: Pick<RoutineRunCardData, "routineName" | "status">): string {
  return t(RUN_PREVIEW[run.status], { name: run.routineName });
}

export function groupPreview(group: Group, bots: Bot[], instances: InstanceInfo[]): string {
  const working = roomWorkingPreview(group, (botId) => bots.find((b) => b.id === botId)?.name);
  if (working) return working;
  if (group.working) return t("sidebar.preview.teamWorking");
  const messages = sidebarPreviewMessages(group);
  const newest = lastPreviewable(messages);
  if (!newest) return t("sidebar.preview.noMessages");
  const last = quotedLine(messages, newest);
  if (last.kind === "text" && last.role !== "user" && isClientCancellation(last.text ?? "")) {
    const stopped = t("chat.turnStopped");
    return last.from ? `${last.from.name}: ${stopped}` : stopped;
  }
  const text = last.kind === "activity" && last.tool
    ? activityPreview(last.tool, botEngine(bots.find((bot) => bot.id === last.from?.botId), instances), last.dataResult)
    : last.kind === "goal.run" && last.goalRun
      ? sidebarGoalRunPreview(last.goalRun)
      : last.kind === "connector" && last.connector
        ? sidebarConnectorPreview(last.connector, t)
        : (last.text ?? "");
  const readable = plainPreviewText(withoutCitationMarkers(text));
  if (last.role === "user") return t("sidebar.preview.you", { text: readable });
  return last.from ? `${last.from.name}: ${readable}` : readable;
}
