import type { Bot, Group, Message } from "@/state/store";
import { isQuestionCard } from "@/lib/question-card";
import { effectiveDefaultResponder, groupComposerHint } from "@/lib/group-routing";
import { t } from "@/lib/i18n";
import type { CSSProperties } from "react";
import { BOT_BUTTON, botButtonStyle, botButtonTone, type BotButton } from "@/lib/bot-button";
import { cn } from "@/lib/cn";
import { GROK_BOT_FILLS } from "./chat-bubble";

// inset-ring, not ring-inset: the --color-inset token turns ring-inset into a ring colour that beats ring-ink
/** Simple mode's composer pill on a wider screen: the field, the mic and the round button in one shell. */
export const SIMPLE_COMPOSER = "composer-pill flex flex-col justify-end bg-composer px-[9px] pt-[7px] pb-[9px] inset-ring-[0.5px] inset-ring-ink/[0.12] hover:inset-ring-ink/[0.24] focus-within:inset-ring-ink/[0.24] data-[drag-over]:inset-ring-accent shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03),0_0_0_1px_rgb(228_228_228/0.04)]";

/** Simple mode's small round controls in the composer: the +, the mic and Stop beside the round button. */
export const SIMPLE_CONTROL = "composer-press size-7 rounded-full bg-ink/[0.06] inset-ring-[0.5px] inset-ring-ink/[0.08] text-ink/[0.56] hover:bg-ink/10 hover:text-ink";

const ROOM_FILL = { fill: "var(--color-accent)", ink: "var(--color-accent-ink)" };

/** The round call, Send and Stop button: the bot's own button, or the accent in a room. */
export function slotColors(color: Bot["color"] | undefined, room: boolean): { fill: string; ink: string; button: BotButton; vars?: CSSProperties } {
  if (room) {
    return { ...ROOM_FILL, button: { className: "hover:brightness-110 disabled:opacity-40", style: { backgroundColor: ROOM_FILL.fill, color: ROOM_FILL.ink } } };
  }
  const own = color ?? "green";
  const tone = botButtonTone(own);
  const grok = GROK_BOT_FILLS[own];
  // on the grok skins the round button wears grok's own colour for the bot, with grok's hover shade (chat.css)
  const vars = grok ? { "--grok-cta-fill": grok.button, "--grok-cta-hover": grok.hover } as CSSProperties : undefined;
  return { fill: grok ? `var(--grok-cta, ${tone.fill})` : tone.fill, ink: tone.ink, button: { className: cn(BOT_BUTTON, grok && "grok-cta"), style: { ...botButtonStyle(own), ...vars } }, vars };
}

export function composerPlaceholder({ simple, locked, approval, attaching, attached = false, listening, replying, busy, canSteer, queued, busyName, sendLabel, group, members, jevOn, goal, botName, setupHint, question = false }: {
  simple: boolean;
  /** A question card waits for the person's answer: grok says the field answers it, or talks past it. */
  question?: boolean;
  locked: boolean;
  approval: boolean;
  attaching: boolean;
  attached?: boolean;
  listening: boolean;
  replying: boolean;
  busy: boolean;
  canSteer: boolean;
  queued: boolean;
  busyName: string;
  sendLabel: string;
  group?: Group;
  members: Bot[];
  jevOn: boolean;
  goal: boolean;
  botName: string;
  setupHint: string | null | undefined;
}): string {
  if (locked) return t("composer.placeholder.lockedChat");
  if (approval) return t("composer.placeholder.approval");
  if (attaching) return t("composer.placeholder.attaching");
  if (listening) return t("composer.placeholder.listening");
  if (replying && !busy) return t("composer.placeholder.reply");
  if (simple) {
    if (question) return t("composer.placeholder.question");
    if (attached) return t("composer.placeholder.attached");
    if (!busy && goal) return group ? t("composer.placeholder.goal", { name: group.name }) : t("composer.placeholder.goalSolo", { name: botName });
    if (!busy && !group && setupHint) return setupHint;
    if (group && !group.dm && effectiveDefaultResponder(group, members).kind === "mentions") {
      return t("composer.placeholder.group", { name: group.name, hint: t("composer.hint.mentions") });
    }
    return t("composer.placeholder.bot", { name: group ? group.name : botName });
  }
  if (busy && canSteer) {
    return queued
      ? t("composer.placeholder.steerQueued", { name: busyName, key: sendLabel })
      : t("composer.placeholder.steer", { name: busyName, key: sendLabel });
  }
  if (busy) {
    return group
      ? t("composer.placeholder.queueGroup", { name: busyName, key: sendLabel })
      : t("composer.placeholder.queue", { name: busyName });
  }
  if (group) {
    return goal
      ? t("composer.placeholder.goal", { name: group.name })
      : t("composer.placeholder.group", { name: group.name, hint: groupComposerHint(group, members, { jevOn }) });
  }
  return setupHint ?? t(goal ? "composer.placeholder.goalSolo" : "composer.placeholder.bot", { name: botName });
}

/** The round Send button's name: what pressing it does now. Simple mode says it in the bot's terms. */
export function sendLabels({ simple, busy, canSteer, name, sendLabel }: { simple: boolean; busy: boolean; canSteer: boolean; name: string; sendLabel: string }): { label: string; title: string } {
  if (busy && canSteer) {
    const steer = simple ? t("composer.send.steerSimple", { name }) : t("composer.send.steer");
    return { label: steer, title: steer };
  }
  if (busy) {
    return simple
      ? { label: t("composer.send.queueSimple", { name }), title: t("composer.send.queueSimple", { name }) }
      : { label: t("composer.send.queue"), title: t("composer.send.queueHint") };
  }
  return { label: t("composer.send.message"), title: `${t("chat.send")} (${sendLabel})` };
}

/** The newest question card still waiting on the person, in the bot's own conversation. */
export function pendingQuestion(messages: readonly Message[] | undefined): boolean {
  if (!messages) return false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const card = messages[index]!.card;
    if (!card || !isQuestionCard(card)) continue;
    return !card.answered && !card.expired && !card.stopped && !card.dismissed;
  }
  return false;
}
