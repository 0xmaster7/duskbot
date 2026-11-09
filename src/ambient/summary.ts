// The app page's summary of its bots for the island and the dock: what each is doing, its newest line, and what waits
// on the person. Read from the store and the live turn statuses the page already keeps.
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { TurnLive } from "@/state/turn-status";
import { botShowsUnread, openAsksOf } from "@/lib/bot-unread";
import { stateForBot } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { turnNowPhrases } from "@/lib/live-activity";
import { pendingApprovals, type Pending } from "@/components/PendingApproval";
import { lastLine, lastPreviewable, sidebarPreviewMessages, waitingLine } from "@/components/sidebar-preview";
import { workingThreadId } from "@/components/SidebarWorkingStep";
import { toolLabel, titledCard } from "@/components/ApprovalCard";
import { answersInOneTap, cardQuestions } from "@/components/QuestionCard";
import { isQuestionCard } from "@/lib/question-card";
import { ambientLabels } from "./labels";
import type { AmbientBot, AmbientSnapshot, AmbientStatus } from "./types";

/** A proposal (a routine, a skill, a profile, a model, a team setup) needs its full card: the island only opens it. */
export function answerableInPlace(pending: Pending): boolean {
  const card = pending.message.card;
  return !(card?.routineRequest || card?.skillRequest || card?.profileRequest || card?.modelRequest || titledCard(card));
}

function statusOf(bot: Bot, waiting: boolean, live: TurnLive, visible: Message[]): AmbientStatus {
  if (waiting) return "needs-you";
  if (bot.busy) return live.status?.activity === "thinking" ? "thinking" : live.status?.activity === "reply" ? "talking" : "working";
  if (stateForBot({ ...bot, messages: visible }) === "failed") return "error";
  if (botShowsUnread(bot)) return "done";
  return "idle";
}

/** The island shows at most this many of a question's choices; a longer list opens the chat. */
export const ISLAND_CHOICES = 4;

const openQuestion = (message: Message) => {
  const card = message.kind === "options" ? message.card : undefined;
  return card && isQuestionCard(card) && !card.answered && !card.pendingAnswer && !card.dismissed && !card.expired && !card.stopped ? card : null;
};

/** The newest open question in the bot's chat, and its choices when one tap answers it. */
export function questionOf(visible: Message[]): { card: NonNullable<Message["card"]>; choices: string[] | null } | null {
  const message = visible.findLast((entry) => openQuestion(entry));
  const card = message && openQuestion(message);
  if (!card) return null;
  const questions = cardQuestions(card);
  const choices = answersInOneTap(questions) && !card.accessRequest ? questions[0]!.options.map((option) => option.label) : null;
  // what main lets through unchanged (electron/ambient-state.mjs), so a tap answers with the very same words
  const fits = choices && choices.length <= ISLAND_CHOICES && choices.every((label) => label.length <= 60 && label === label.replace(/\s+/g, " ").trim());
  return { card, choices: fits ? choices : null };
}

/** Whether the bot waits on the person: a question, an approval or a card of choices in any of its chats. */
export function waitsOnPerson(bot: Bot, visible: Message[] = sidebarPreviewMessages(bot)): boolean {
  const newest = lastPreviewable(visible);
  const card = newest?.kind === "options" ? newest.card : undefined;
  const openCard = Boolean(card && !card.answered && !card.dismissed && !card.expired);
  return bot.activity === "waiting-on-you" || (bot.tasks ?? []).some((task) => task.activity === "waiting-on-you") || openAsksOf(bot) > 0 || pendingApprovals(visible).length > 0 || openCard;
}

export function ambientBot(bot: Bot, instances: InstanceInfo[], turnLive: (threadId: string) => TurnLive): AmbientBot {
  const visible = sidebarPreviewMessages(bot);
  const approvals = pendingApprovals(visible);
  const asks = Math.max(openAsksOf(bot), approvals.length);
  const newest = lastPreviewable(visible);
  const waiting = waitsOnPerson(bot, visible);
  const workingOn = bot.busy ? workingThreadId(bot) : bot.threadId;
  const live = turnLive(workingOn);
  const status = statusOf(bot, waiting, live, visible);
  const inPlace = approvals.find(answerableInPlace);
  const detail = status === "needs-you"
    ? inPlace ? t("ambient.wantsTo", { action: toolLabel(inPlace.tool) }) : waitingLine(bot, visible, instances)
    : bot.busy ? turnNowPhrases(live.status, workingOn === bot.threadId ? newest : undefined)?.phrases[0] ?? t("chat.activity.thinking") : "";
  const question = status === "needs-you" ? questionOf(visible) : null;
  const waits = status !== "needs-you" ? null : question ? "question" : approvals.length ? "approval" : "other";
  return {
    id: bot.id,
    threadId: bot.threadId,
    name: bot.name,
    color: bot.color,
    body: bot.mascotBody ?? null,
    face: bot.mascotFaceColor ?? null,
    avatar: bot.avatarCrop && bot.avatarCrop !== "mascot" && bot.avatarUrl?.startsWith("/") ? bot.avatarUrl : null,
    status,
    detail,
    line: lastLine(bot, visible, instances),
    at: Math.max(newest?.at ?? 0, bot.turnStartedAt ?? 0),
    unread: botShowsUnread(bot),
    asks,
    approval: inPlace ? { requestId: inPlace.requestId, threadId: bot.threadId, title: inPlace.detail || toolLabel(inPlace.tool) } : null,
    waits,
    question: question?.choices && question.card.requestId
      ? { requestId: question.card.requestId, threadId: bot.threadId, title: cardQuestions(question.card)[0]?.question || question.card.title, choices: question.choices }
      : null,
  };
}

/** Every bot the sidebar lists, as the surfaces show them. */
export function ambientSnapshot(bots: Bot[], instances: InstanceInfo[], turnLive: (threadId: string) => TurnLive, lang: string): AmbientSnapshot {
  return { bots: bots.filter((bot) => !bot.hidden && !bot.movedTo).map((bot) => ambientBot(bot, instances, turnLive)), labels: ambientLabels(), lang };
}
