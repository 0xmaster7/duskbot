import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Check, Clock3, LoaderCircle, Square, X } from "lucide-react";
import { botButton, type BotButton } from "@/lib/bot-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

/** The bot a card asks for: its face and name lead the card. */
export type Asker = Pick<Bot, "name" | "color"> & Partial<Pick<Bot, "avatarUrl" | "avatarCrop" | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "mascotBody" | "mascotFaceColor">>;

export function AskHeader({ asker, line, origin }: { asker: Asker; line: string; origin?: { label: string; hint: string; open(): void } }) {
  return (
    <div data-ask-header="" className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-ink-secondary">
      <span aria-hidden="true" className="flex shrink-0"><BotAvatar bot={asker} state="happy" size={16} animated={false} motion="none" motionKey={0} label="" /></span>
      <span dir="auto" className="min-w-0 truncate">{line}</span>
      {origin && (
        <button type="button" onClick={origin.open} aria-label={origin.hint} title={origin.hint}
          className="-ms-1 min-w-0 shrink truncate rounded-md px-1 text-ink-tertiary hover:bg-ink/[0.06] hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          · {origin.label}
        </button>
      )}
    </div>
  );
}

export function AskCard({
  header,
  source,
  icon,
  title,
  meta,
  explanation,
  onDismiss,
  dismissLabel,
  ariaLabel,
  tour,
  children,
  footer,
  onKeyDown,
  stays = false,
}: {
  /** An AskHeader: who asks, above the question. */
  header?: ReactNode;
  /** Grok's titlebar: where the ask comes from, an icon in a small tile and a name, above the title. */
  source?: { icon: ReactNode; label: ReactNode };
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  explanation?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  ariaLabel: string;
  tour?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Work rests on this card and the person's answer alone moves it: it stays in view however far the chat scrolls. */
  stays?: boolean;
}) {
  const dismiss = onDismiss && dismissLabel ? (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={dismissLabel}
      title={dismissLabel}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:size-9",
        source ? "-me-1 size-6" : "-me-1.5 size-7",
        !source && (header ? "-mt-7" : "-mt-0.5"),
      )}
    >
      <X size={source ? 14 : 15} />
    </button>
  ) : null;
  // stays: work rests on the answer, so the card holds in view however far the chat scrolls
  const frame = cn("w-full max-w-[560px] rounded-[24px] text-start", ASK_CARD_RING, ASK_CARD_LIFT, stays && "sticky top-[60px] bottom-[72px] z-10");
  if (source) {
    return (
      <div role="group" aria-label={ariaLabel} data-tour={tour} data-ask-card="pending" onKeyDown={onKeyDown} className={frame}>
        <CardTitlebar icon={source.icon} label={source.label} trailing={dismiss} />
        <div className="px-5 py-1">
          <p className="break-words text-[15px] font-semibold leading-[22px] text-ink"><bdi dir="auto">{title}</bdi></p>
          {explanation && <div className="break-words text-[14px] leading-5 text-ink-secondary">{explanation}</div>}
        </div>
        {children ? <div className="p-4">{children}</div> : !footer && <div className="pb-4" />}
        {footer && <div className={cn("flex flex-wrap items-center justify-end gap-2 px-4 pb-4", children ? "pt-0" : "pt-2.5")}>{footer}</div>}
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-tour={tour}
      data-ask-card="pending"
      onKeyDown={onKeyDown}
      className={cn(frame, "px-4 pt-3.5", footer ? "pb-3" : "pb-2")}
    >
      {header && <div className="mb-1.5 pe-6">{header}</div>}
      <div className="flex min-w-0 items-start gap-2">
        {icon && <span aria-hidden="true" className="mt-[3px] flex shrink-0 text-ink-secondary">{icon}</span>}
        <div className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-[22px] text-ink">
          <bdi dir="auto">{title}</bdi>
        </div>
        {meta && <span className="mt-0.5 shrink-0 text-[12px] tabular-nums text-ink-tertiary">{meta}</span>}
        {dismiss}
      </div>
      {explanation && <div className="mt-1 text-[14px] leading-5 text-ink-secondary">{explanation}</div>}
      {children && <div className="mt-3">{children}</div>}
      {footer && <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
    </div>
  );
}

/** Grok's card titlebar: the source's icon in a 20px tile, its name in medium 13px, anything else at the end. */
export function CardTitlebar({ icon, label, trailing }: { icon: ReactNode; label: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-[52px] min-w-0 items-center gap-2 px-4 py-3.5">
      <CardSourceIcon>{icon}</CardSourceIcon>
      <span dir="auto" className="min-w-0 truncate text-[13px] font-medium leading-[18px] text-ink">{label}</span>
      {trailing && <span className="ms-auto flex shrink-0 items-center">{trailing}</span>}
    </div>
  );
}

export function CardSourceIcon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-ink/[0.06] bg-ink/[0.06] text-ink-secondary">
      {children}
    </span>
  );
}

/**
 * Grok's settled card: the same raised frame folded to one 52px row, the source then one grey line of what happened.
 * With more to say it opens in place to a title and that detail.
 */
export function CardSettledRow({ icon, label, summary, tone = "done", title, detail, action, ariaLabel }: {
  icon: ReactNode;
  label: ReactNode;
  summary: ReactNode;
  tone?: AskSettledTone | "failed";
  /** The opened card's heading; with detail, the row opens to show both. */
  title?: ReactNode;
  detail?: ReactNode;
  /** A retry beside the summary, outside the toggle. */
  action?: ReactNode;
  ariaLabel?: string;
}) {
  // a failure stays open, so what went wrong is read without a click
  const [open, setOpen] = useState(tone === "failed");
  const opens = Boolean(title || detail);
  const row = (
    <>
      <CardSourceIcon>{icon}</CardSourceIcon>
      <span className="shrink-0 font-medium text-ink">{label}</span>
      <span dir="auto" aria-live="polite" className={cn("min-w-0 truncate", tone === "failed" ? "text-danger" : "text-ink-tertiary")}>{summary}</span>
    </>
  );
  const rowClass = "flex min-h-[52px] min-w-0 flex-1 items-center gap-2 px-4 py-3.5 text-start text-[13px] leading-[18px]";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-ask-card="settled"
      data-tone={tone}
      className={cn("w-full max-w-[560px]", ASK_CARD_RING, ASK_CARD_LIFT, open ? "rounded-[24px]" : "rounded-[18px]")}
    >
      <div className="flex min-w-0 items-center">
        {opens ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
            className={cn(rowClass, "rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus")}>
            {row}
          </button>
        ) : <div className={rowClass}>{row}</div>}
        {action && <span className="flex shrink-0 items-center pe-3">{action}</span>}
      </div>
      {open && opens && (
        <div className="px-5 pb-4 pt-1">
          {title && <p className="break-words text-[15px] font-semibold leading-[22px] text-ink">{title}</p>}
          {detail && <div className="break-words text-[14px] leading-5 text-ink-secondary">{detail}</div>}
        </div>
      )}
    </div>
  );
}

/** A command, a link or a quoted message beside the question: a quiet block that folds after three lines. */
export function AskDetail({ text, mono = false, label }: { text: string; mono?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 180 || text.split("\n").length > 3;
  return (
    <div className="mt-2">
      <div
        dir="auto"
        aria-label={label}
        className={cn("rounded-[12px] border border-ink/[0.06] bg-ink/[0.04] px-3 py-2 [overflow-wrap:anywhere]",
          mono ? "font-mono text-[13px] leading-[18px] whitespace-pre-wrap text-ink" : "whitespace-pre-wrap text-[13px] leading-5 text-ink-secondary",
          long && !open && "line-clamp-3")}
      >
        {text}
      </div>
      {long && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={cn(ASK_QUIET_BUTTON, "mt-1 -ms-2")}>
          {open ? t("question.showLess") : t("ask.detail.more")}
        </button>
      )}
    </div>
  );
}

export type AskChoice = { label: string; description?: string };

/** A question card rests a hair above the page, like the bubbles beside it. */
export const ASK_CARD_LIFT = "shadow-[0_2px_8px_color-mix(in_srgb,var(--color-ink)_3.5%,transparent)]";
/** Grok's card edge: a 0.5px ring at 12% ink. */
export const ASK_CARD_RING = "bg-composer ring-[0.5px] ring-ink/[0.12]";

/** The letter that names a choice, A to Z, then none: a long list reads by its labels. */
export const choiceLetter = (index: number): string | null => index < 26 ? String.fromCharCode(65 + index) : null;

export function ChoiceLetter({ letter, quiet = false, fill }: { letter: string | null; quiet?: boolean; fill?: string }) {
  if (!letter) return null;
  return (
    <kbd aria-hidden="true" data-letter={letter} style={fill ? { backgroundColor: fill } : undefined} className={cn("flex size-6 shrink-0 items-center justify-center rounded-[8px] border border-ink/[0.08] font-sans text-[12px] font-medium leading-4 before:content-[attr(data-letter)]",
      fill ? "text-white" : quiet ? "bg-ink/[0.04] text-ink-tertiary" : "bg-ink/[0.06] text-ink-secondary")} />
  );
}

/** The answers a question offers, one button each, stacked so a long label wraps instead of being cut. */
export function AskChoices({ choices, label, onPick, sending = null, picked = [], multi = false, disabled = false, quiet = false, tag }: {
  choices: readonly AskChoice[];
  /** The question, for screen readers. */
  label: string;
  onPick(label: string): void;
  /** The choice on its way: it shows that it is being sent, and the others wait. */
  sending?: string | null;
  picked?: readonly string[];
  multi?: boolean;
  disabled?: boolean;
  /** The person has written past this card: its choices recede but still answer. */
  quiet?: boolean;
  /** A data attribute each choice carries with its label, for the surface that shows it. */
  tag?: `data-${string}`;
}) {
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={label} onKeyDown={moveChoiceFocus} className="-mx-2 flex flex-col gap-px">
      {choices.map((choice, index) => {
        const on = picked.includes(choice.label) || sending === choice.label;
        return (
          <button
            key={choice.label}
            type="button"
            data-ask-choice=""
            {...(tag ? { [tag]: choice.label } : {})}
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            aria-busy={sending === choice.label || undefined}
            disabled={disabled || (sending !== null && sending !== choice.label)}
            onClick={() => onPick(choice.label)}
            className={cn(ASK_CHOICE, on ? "bg-ink/[0.06]" : "enabled:hover:bg-ink/[0.06]", quiet && !on && "text-ink-secondary")}
          >
            <ChoiceLetter letter={choiceLetter(index)} quiet={quiet && !on} />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block break-words [unicode-bidi:plaintext]">{choice.label}</span>
              {choice.description && <span dir="auto" className="mt-0.5 block break-words text-[13px] leading-[18px] text-ink-secondary [unicode-bidi:plaintext]">{choice.description}</span>}
            </span>
            {sending === choice.label
              ? <LoaderCircle size={16} aria-hidden="true" className="shrink-0 text-ink-secondary motion-safe:animate-spin" />
              : on && <Check size={16} strokeWidth={2.4} aria-hidden="true" className="shrink-0 text-ink" />}
          </button>
        );
      })}
    </div>
  );
}

/** The person's own words: a field and a send button in the asking bot's colour. */
export function AskReply({ label, placeholder, color, onSend, sending = false, value, onChange, maxLength, multiline = false, letter }: {
  label: string;
  placeholder: string;
  color: MausColor | undefined;
  onSend(text: string): void;
  sending?: boolean;
  value: string;
  onChange(text: string): void;
  maxLength?: number;
  multiline?: boolean;
  /** The field closes a list of choices: it is the next lettered row, and its send button shows once there are words. */
  letter?: string | null;
}) {
  const ready = value.trim().length > 0 && !sending;
  const row = letter !== undefined;
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready) onSend(value.trim());
  };
  const button = askPrimary(color, row ? ASK_ROW_SEND_SHAPE : ASK_ICON_SHAPE);
  return (
    <form onSubmit={send} className={row
      ? "-mx-2 flex min-h-10 items-center gap-2.5 rounded-[16px] border border-transparent p-[7px] transition-[background-color,border-color] duration-[140ms] ease-[cubic-bezier(.16,1,.3,1)] hover:bg-ink/[0.06] focus-within:bg-ink/[0.06]"
      : "flex items-end gap-2 rounded-[16px] border border-ink/10 bg-transparent py-1 pe-1 ps-3 "}>
      {row && <ChoiceLetter letter={letter ?? null} />}
      <textarea
        dir="auto"
        rows={1}
        value={value}
        maxLength={maxLength}
        aria-label={label}
        placeholder={placeholder}
        disabled={sending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
        }}
        className={cn("block flex-1 resize-none bg-transparent text-[14px] leading-5 text-ink outline-none [field-sizing:content]", row ? "placeholder:text-ink/40" : "placeholder:text-ink-tertiary",
          row ? "min-h-5 py-0.5" : "min-h-8 py-1.5 pointer-coarse:min-h-9", multiline ? "max-h-40" : "max-h-28")}
      />
      {(!row || ready || sending) && <button type="submit" disabled={!ready} aria-label={t("chat.send")} title={t("chat.send")} aria-busy={sending || undefined} {...button}>
        {sending ? <LoaderCircle size={16} aria-hidden="true" className="motion-safe:animate-spin" /> : <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />}
      </button>}
    </form>
  );
}

/** Why an answer did not go, under the card, until the next try. */
export function AskError({ children }: { children: ReactNode }) {
  return <p role="alert" className="mt-2 text-[13px] leading-[18px] text-danger">{children}</p>;
}

export type AskSettledTone = "done" | "closed" | "stopped" | "expired";

const SETTLED_ICON: Record<AskSettledTone, ReactNode> = {
  done: <Check size={13} strokeWidth={2.4} className="text-success" />,
  closed: <X size={13} />,
  stopped: <Square size={11} strokeWidth={2.4} />,
  expired: <Clock3 size={13} />,
};

export function AskSettledLine({
  icon,
  tone = "done",
  children,
  action,
  detail,
  ariaLabel,
}: {
  icon?: ReactNode;
  tone?: AskSettledTone;
  children: ReactNode;
  action?: ReactNode;
  detail?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-ask-card="settled"
      data-tone={tone}
      className="w-full max-w-[560px] text-start text-[13px] leading-[18px] text-ink-tertiary"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
          {icon ?? SETTLED_ICON[tone]}
        </span>
        <span dir="auto" aria-live="polite" className="min-w-0 truncate">{children}</span>
        {action}
      </div>
      {detail}
    </div>
  );
}

/** "You chose: …" when the answer is one of the choices, "You answered: …" for the person's own words. */
export function settledAnswer(answer: string, choices: readonly string[]): ReactNode {
  const label = t(choices.includes(answer) ? "ask.settled.chose" : "ask.settled.answered");
  return <><span>{label}</span> <span className="text-ink-secondary">{answer}</span></>;
}

/**
 * A fixed height with a centered line box keeps Arabic and Latin labels on one baseline band; vertical padding lets
 * each script's font metrics push text off center.
 */
const ASK_SHAPE =
  "omb-press inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium leading-5 [&>svg]:shrink-0 disabled:cursor-not-allowed pointer-coarse:h-9";
/** A card's answers: at least 36px tall, 44 on a touch screen, and a label that wraps rather than being cut. */
export const ASK_BUTTON_SHAPE =
  "omb-press inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-center text-[14px] font-medium leading-5 [&>svg]:shrink-0 disabled:cursor-not-allowed pointer-coarse:min-h-11";
const ASK_ROW_SEND_SHAPE = "inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed pointer-coarse:size-9";
export const ASK_ICON_SHAPE = "omb-press inline-flex size-8 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed pointer-coarse:size-9";
const ASK_LOOK = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40";
const ASK_CONTROL = `${ASK_SHAPE} ${ASK_LOOK}`;
const ASK_PRIMARY_LOOK = `${ASK_LOOK} ui-button-primary bg-accent text-accent-ink hover:brightness-110`;

export const ASK_PRIMARY_BUTTON = `${ASK_SHAPE} ${ASK_PRIMARY_LOOK}`;

/** The answer a card waits for: grok's ink pill whoever asks; a bot's colour stays in its face and its answered letter. */
export function askPrimary(_color: MausColor | undefined, shape = ASK_BUTTON_SHAPE): BotButton {
  return botButton(undefined, shape, ASK_PRIMARY_LOOK);
}

/**
 * Grok's card buttons: 36px for a card's own answer (I'm done, Submit), 32px for a permission's three (Allow once, Always
 * allow, Never), 44 on a touch screen. Primary ink, secondary a 6% ink fill, tertiary bare regular text.
 */
const CARD_BUTTON = "omb-press inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full text-[14px] leading-5 [&>svg]:shrink-0 disabled:cursor-not-allowed pointer-coarse:h-11";
export const CARD_BUTTON_LG = `${CARD_BUTTON} h-9 px-4`;
export const CARD_BUTTON_MD = `${CARD_BUTTON} h-8 px-3.5`;
export const cardPrimary = (size: string = CARD_BUTTON_LG): BotButton => botButton(undefined, `${size} font-medium`, ASK_PRIMARY_LOOK);
export const cardSecondary = (size: string = CARD_BUTTON_LG) => `${size} ${ASK_LOOK} font-medium bg-ink/[0.06] text-ink enabled:hover:bg-ink/[0.1] enabled:active:bg-ink/[0.14]`;
export const cardTertiary = (size: string = CARD_BUTTON_LG) => `${size} ${ASK_LOOK} font-normal text-ink-secondary enabled:hover:bg-ink/[0.06] enabled:hover:text-ink enabled:active:bg-ink/[0.1]`;

/** A card's other answers: Deny, Cancel, Not now. */
export const ASK_SECONDARY_BUTTON = `${ASK_BUTTON_SHAPE} ${ASK_LOOK} bg-ink/[0.07] text-ink enabled:hover:bg-ink/[0.11] enabled:active:bg-ink/[0.15]`;
/** An extra option that should not compete with the answer: Always allow, Details. Grok's Discard: regular weight beside the medium primary. */
export const ASK_QUIET_ANSWER = `${ASK_BUTTON_SHAPE.replace("font-medium", "font-normal")} ${ASK_LOOK} text-ink-secondary enabled:hover:bg-ink/[0.06] enabled:hover:text-ink enabled:active:bg-ink/[0.1]`;

/** Grok's option row: 40 tall, a 1px clear edge, its fill and edge easing in over 140ms. */
export const ASK_CHOICE = `omb-press-soft flex min-h-10 w-full items-center gap-2.5 rounded-[16px] border border-transparent p-[7px] pe-3 text-start text-[14px] leading-5 text-ink ${ASK_LOOK} disabled:cursor-default pointer-coarse:min-h-11`;

export const ASK_CHIP = `${ASK_CONTROL} max-w-full border`;
export const ASK_CHIP_IDLE = "border-transparent bg-ink/[0.07] text-ink hover:bg-ink/[0.12]";
export const ASK_CHIP_PICKED = "border-accent bg-accent/15 text-ink";

export const ASK_SMALL_PILL = ASK_CONTROL;
export const ASK_QUIET_BUTTON = `${ASK_SMALL_PILL} -my-1 text-ink-tertiary hover:bg-ink/[0.07] hover:text-ink-secondary`;

/**
 * Grok's card field: no fill, one quiet hairline, 32 tall, 10px corners, unchanged when focused (the caret is the cue).
 * Moving by keyboard draws the app's grey focus ring around it, never a blue one.
 */
export const CARD_FIELD =
  "h-8 rounded-[10px] border border-ink/[0.12] bg-transparent px-3 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-2 disabled:opacity-60 pointer-coarse:h-11";

export const ASK_FIELD =
  "h-7 rounded-full border border-hairline/60 bg-inset px-3 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus:border-accent disabled:opacity-60 pointer-coarse:h-9";

export function returnFocusToComposer(): void {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
}

export function moveChoiceFocus(event: KeyboardEvent<HTMLElement>): void {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const group = event.currentTarget;
  const items = Array.from(group.querySelectorAll<HTMLElement>("[data-ask-choice]:not([disabled])"));
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const rtl = getComputedStyle(group).direction === "rtl";
  const forward = event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight");
  const backward = event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft");
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (forward) next = current < 0 ? 0 : (current + 1) % items.length;
  else if (backward) next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  event.preventDefault();
  items[next]?.focus();
}
