// One bot as the dock and the island list it: its mascot, its name, what it is doing or just said, and the ask it waits
// on, answered right there. An idle bot says nothing. The mascot carries the state; the words only add what it can't.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Check, CircleAlert, CircleHelp, CornerUpLeft, FileCheck2, KeyRound, Plug, ShieldCheck, Square, X } from "lucide-react";
import { finishedSince, isBusy, shortAgo } from "./mood";
import { say, type AmbientLabels } from "./say";
import { FADE, FADE_OUT, SETTLE } from "./shared";
import type { AmbientAct, AmbientBot, AmbientWait } from "./types";

/** The highlight waits this long before fading when the pointer slips off the list. */
export const BAND_LEAVE_MS = 140;
/** Landing on a row as the surface opens is not choosing it: a move this far, or resting this long, is. */
export const INTENT_PX = 6;
export const INTENT_MS = 450;

/**
 * One highlight for a whole hover session: made once, it glides from row to row on the settle spring (y and height),
 * never unmounting or dipping out between bots, and fades only once the pointer has left the list for a moment. Rows
 * carry `data-row` and call `point` as the pointer reaches them; `measureKey` changes when rows move or resize.
 */
export function useHoverBand(list: RefObject<HTMLElement | null>, active: boolean, measureKey: unknown) {
  const reduced = useReducedMotion() === true;
  const [under, setUnder] = useState<string | null>(null);
  const [band, setBand] = useState<{ y: number; h: number } | null>(null);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const point = useCallback((id: string | null) => {
    clearTimeout(leave.current);
    if (id) setUnder(id);
    else leave.current = setTimeout(() => setUnder(null), BAND_LEAVE_MS);
  }, []);
  useEffect(() => () => clearTimeout(leave.current), []);
  useEffect(() => { if (!active) setUnder(null); }, [active]);
  useLayoutEffect(() => {
    const row = under ? list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(under)}"]`) : null;
    if (row) setBand((was) => (was && was.y === row.offsetTop && was.h === row.offsetHeight ? was : { y: row.offsetTop, h: row.offsetHeight }));
  }, [under, measureKey, list]);
  const [chose, setChose] = useState(false);
  useEffect(() => {
    setChose(false);
    if (!active) return;
    let landed: { x: number; y: number } | null = null;
    const timer = setTimeout(() => setChose(true), INTENT_MS);
    const move = (event: MouseEvent) => {
      if (!landed) { landed = { x: event.clientX, y: event.clientY }; return; }
      if (Math.hypot(event.clientX - landed.x, event.clientY - landed.y) > INTENT_PX) setChose(true);
    };
    document.addEventListener("mousemove", move, { passive: true });
    return () => { clearTimeout(timer); document.removeEventListener("mousemove", move); };
  }, [active]);
  const shown = Boolean(active && chose && under && band);
  // coming back after it faded, it appears where the pointer is rather than sliding over from where it was
  const was = useRef(false);
  const glide = was.current && !reduced ? SETTLE : { duration: 0 };
  useEffect(() => { was.current = shown; });
  const element = (
    <motion.li
      aria-hidden
      role="presentation"
      className="amb-band"
      data-on={shown ? under! : undefined}
      initial={false}
      animate={{ y: band?.y ?? 0, height: band?.h ?? 0, opacity: shown ? 1 : 0 }}
      transition={{ y: glide, height: glide, opacity: shown ? FADE : FADE_OUT }}
    />
  );
  return { element, point, under: shown ? under : null };
}

/** A row says Sent this long after an ask is answered from it, unless the summary moves on first. */
export const SENT_MS = 8_000;
/** A bot that just finished a turn celebrates this long. */
export const CHEER_MS = 2_600;

type LineKind = "busy" | "ask" | "reply" | "error" | "recent" | "none";

/** What the row says under the name: what a working bot is doing, the ask, the reply's first line, or the failure. */
export function rowLine(bot: AmbientBot, labels: AmbientLabels): { text: string; kind: LineKind } {
  const detail = bot.detail && bot.detail !== say(labels, bot.status) ? bot.detail : "";
  if (isBusy(bot.status)) return { text: detail || say(labels, bot.status), kind: "busy" };
  if (bot.status === "needs-you") {
    const text = bot.question?.title || (bot.approval?.title && detail ? `${detail}: ${bot.approval.title}` : detail || bot.line);
    return { text, kind: "ask" };
  }
  if (bot.status === "done") return { text: bot.line, kind: "reply" };
  if (bot.status === "error") return { text: bot.line || say(labels, "error"), kind: "error" };
  return { text: "", kind: "none" };
}

const ASK_ICON: Record<AmbientWait, typeof CircleHelp> = {
  question: CircleHelp, approval: ShieldCheck, "sign-in": KeyRound, password: KeyRound, connect: Plug, review: FileCheck2, other: CircleHelp,
};

/** Asks answered from this surface a moment ago, and bots that just finished a turn. */
export function useRowMoments(bots: readonly AmbientBot[]) {
  const [sent, setSent] = useState<ReadonlyMap<string, string>>(new Map());
  const [cheering, setCheering] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.current.delete(timer); fn(); }, ms);
    timers.current.add(timer);
  };
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);

  const before = useRef<readonly AmbientBot[] | null>(null);
  useEffect(() => {
    const finished = finishedSince(before.current, bots);
    before.current = bots;
    // an answered ask that moved on (answered, or a new one) is no longer "Sent"
    setSent((was) => {
      const next = new Map([...was].filter(([id, key]) => bots.some((bot) => bot.id === id && askKey(bot) === key)));
      return next.size === was.size ? was : next;
    });
    if (!finished.length) return;
    setCheering((was) => new Set([...was, ...finished]));
    later(() => setCheering((was) => new Set([...was].filter((id) => !finished.includes(id)))), CHEER_MS);
  }, [bots]);

  const markSent = (bot: AmbientBot) => {
    const key = askKey(bot);
    setSent((was) => new Map(was).set(bot.id, key));
    later(() => setSent((was) => {
      if (was.get(bot.id) !== key) return was;
      const next = new Map(was);
      next.delete(bot.id);
      return next;
    }), SENT_MS);
  };
  return { sent, cheering, markSent };
}

const askKey = (bot: AmbientBot) => `${bot.status}:${bot.question?.requestId ?? bot.approval?.requestId ?? bot.waits ?? ""}`;

export interface BotRowProps {
  bot: AmbientBot;
  labels: AmbientLabels;
  lang: string;
  now: number;
  side: "dock" | "island" | "card";
  /** The words show (the dock is open, or the island's panel is). */
  open: boolean;
  sent: boolean;
  mascot: ReactNode;
  /** A reply or failure the person has seen (seen.ts): its line stays, muted, and asks for nothing. */
  recent?: boolean;
  onOpen: () => void;
  onAct: (act: AmbientAct) => void;
  onPin: (pinned: boolean) => void;
  /** Marks a fresh reply or failure seen without opening it. */
  onDismiss?: () => void;
  /** Its ask is answered somewhere else on screen (the mini chat open under it). */
  hideTray?: boolean;
}

/** The island's rows open their mini chat in place rather than the app. */
const opensInPlace = (side: BotRowProps["side"]) => side === "island";

export function BotRow({ bot: given, labels, lang, now, side, open, sent, mascot, recent = false, onOpen, onAct, onPin, onDismiss, hideTray = false }: BotRowProps) {
  // a seen reply or failure rests like an idle bot, keeping only its line
  const bot = recent ? { ...given, status: "idle" as const, unread: false } : given;
  const fresh = !recent && (bot.status === "done" || bot.status === "error");
  const [field, setField] = useState<"reply" | "answer" | null>(null);
  useEffect(() => { if (!open) setField(null); }, [open]);
  // a field for an ask that went away goes with it
  const ask = bot.status === "needs-you" && !sent ? bot : null;
  useEffect(() => { if (field === "answer" && !ask?.question?.custom) setField(null); }, [field, ask]);
  const line = sent ? { text: say(labels, "sent"), kind: "none" as LineKind } : recent ? { text: given.line, kind: "recent" as LineKind } : rowLine(bot, labels);
  const busy = isBusy(bot.status);
  const time = (bot.status === "idle" && !recent) || busy ? "" : shortAgo(bot.at, now, lang, say(labels, "now"));
  const label = [opensInPlace(side) ? bot.name : say(labels, "open", { name: bot.name }), bot.status === "idle" ? "" : say(labels, bot.status), line.text].filter(Boolean).join(". ");
  const act = (next: AmbientAct) => { setField(null); onAct(next); };
  // in the dock the column beside a waiting row says what kind of ask it is, even with the words put away
  const Glyph = side !== "dock" ? null : ask ? ASK_ICON[bot.waits ?? "other"] : bot.status === "error" ? CircleAlert : null;
  const tray = sent || hideTray ? null : trayFor(bot, labels, field, setField, act, onOpen, onPin);

  return (
    <div className="amb-row" data-side={side} data-status={bot.status} data-sent={sent || undefined}>
      <button type="button" className="amb-row-main" tabIndex={side === "dock" ? -1 : 0} aria-label={label} aria-expanded={opensInPlace(side) ? hideTray : undefined} onClick={onOpen}>
        <span className="amb-row-top">
          <span className="amb-row-name">{bot.name}</span>
          {bot.unread && bot.status === "done" && <span className="amb-unread" aria-hidden />}
          {time && <span className="amb-row-time">{time}</span>}
        </span>
        {line.text && (
          <span className="amb-row-line" data-kind={sent ? "sent" : line.kind} dir="auto">
            {sent && <Check size={12} strokeWidth={2.25} aria-hidden />}
            {line.kind === "error" && <CircleAlert size={12} strokeWidth={2} aria-hidden />}
            <span className="amb-row-words">{line.text}</span>
          </span>
        )}
      </button>
      <div className="amb-row-actions">
        {busy && (
          <button type="button" className="amb-icon" aria-label={say(labels, "stop", { name: bot.name })} title={say(labels, "stop", { name: bot.name })} onClick={() => onAct({ kind: "stop", botId: bot.id, threadId: bot.threadId })}>
            <Square size={10} strokeWidth={2} fill="currentColor" aria-hidden />
          </button>
        )}
        {fresh && onDismiss && (
          <button type="button" className="amb-icon amb-quiet" aria-label={`${say(labels, "dismiss")}: ${bot.name}`} title={say(labels, "dismiss")} onClick={onDismiss}>
            <X size={13} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        {!ask && !busy && (
          <button type="button" className="amb-icon amb-quiet" data-on={field === "reply" || undefined} aria-expanded={field === "reply"} aria-label={say(labels, "replyTo", { name: bot.name })} title={say(labels, "reply")} onClick={() => setField((was) => (was === "reply" ? null : "reply"))}>
            <CornerUpLeft size={13} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
      {mascot && <div className="amb-row-mark">{mascot}</div>}
      <AnimatePresence initial={false}>
        {tray && (
          <Reveal key="tray" className="amb-tray-wrap">
            <div className="amb-tray">{tray}</div>
          </Reveal>
        )}
      </AnimatePresence>
      {Glyph && <span className="amb-ask-glyph" data-kind={bot.status} aria-hidden><Glyph size={13} strokeWidth={2} /></span>}
    </div>
  );
}

/** Height from nothing and back on the panel's own spring; opacity on its short clock. */
export function Reveal({ children, className }: { children: ReactNode; className: string }) {
  const reduced = useReducedMotion() === true;
  return (
    <motion.div
      className={className}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1, transition: { height: reduced ? { duration: 0 } : SETTLE, opacity: FADE } }}
      exit={{ height: 0, opacity: 0, transition: { height: reduced ? { duration: 0 } : SETTLE, opacity: FADE_OUT } }}
    >
      {children}
    </motion.div>
  );
}

export function trayFor(
  bot: AmbientBot, labels: AmbientLabels, field: "reply" | "answer" | null, setField: (next: "reply" | "answer" | null) => void,
  act: (next: AmbientAct) => void, onOpen: () => void, onPin: (pinned: boolean) => void,
): ReactNode {
  const close = () => setField(null);
  if (field === "reply") {
    return <TextField label={say(labels, "replyTo", { name: bot.name })} send={say(labels, "send")} onPin={onPin} onCancel={close} onSend={(text) => act({ kind: "reply", botId: bot.id, threadId: bot.threadId, text })} />;
  }
  if (bot.status === "needs-you") {
    const { question, approval } = bot;
    if (question) {
      const typing = field === "answer" || (!question.choices.length && question.custom);
      return (
        <>
          {question.choices.length > 0 && (
            <div className="amb-choices" role="group" aria-label={question.title}>
              {question.choices.map((choice) => (
                <button key={choice} type="button" className="amb-pill" onClick={() => act({ kind: "answer", botId: bot.id, threadId: question.threadId, requestId: question.requestId, text: choice })}>{choice}</button>
              ))}
              {question.custom && !typing && <button type="button" className="amb-pill amb-pill-ghost" onClick={() => setField("answer")}>{say(labels, "answer")}</button>}
            </div>
          )}
          {typing && (
            <TextField
              label={say(labels, "answer")}
              send={say(labels, "send")}
              focus={field === "answer"}
              onPin={onPin}
              onCancel={close}
              onSend={(text) => act({ kind: "answer", botId: bot.id, threadId: question.threadId, requestId: question.requestId, text })}
            />
          )}
        </>
      );
    }
    if (approval) {
      return (
        <div className="amb-choices">
          <button type="button" className="amb-pill amb-pill-primary" onClick={() => act({ kind: "allow", botId: bot.id, threadId: approval.threadId, requestId: approval.requestId })}>{say(labels, "allow")}</button>
          <button type="button" className="amb-pill" onClick={() => act({ kind: "deny", botId: bot.id, threadId: approval.threadId, requestId: approval.requestId })}>{say(labels, "deny")}</button>
        </div>
      );
    }
    return <div className="amb-choices"><button type="button" className="amb-pill amb-pill-primary" onClick={onOpen}>{say(labels, "openShort")}</button></div>;
  }
  if (bot.status === "error") return <div className="amb-choices"><button type="button" className="amb-pill" onClick={onOpen}>{say(labels, "openShort")}</button></div>;
  return null;
}

export function TextField({ label, send, focus = true, onPin, onCancel, onSend }: {
  label: string; send: string; focus?: boolean; onPin: (pinned: boolean) => void; onCancel: () => void; onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) input.current?.focus({ preventScroll: true });
  }, [focus]);
  // an unsent draft holds the surface open (and keeps the keyboard); an empty field, or one just sent, does not
  const drafting = focused && text.trim().length > 0;
  useEffect(() => { onPin(drafting); }, [drafting, onPin]);
  useEffect(() => () => onPin(false), [onPin]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    onSend(message);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onCancel();
  };
  return (
    <form className="amb-reply" onSubmit={submit}>
      <input
        ref={input}
        className="amb-reply-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        aria-label={label}
        placeholder={label}
        maxLength={2000}
        autoComplete="off"
        spellCheck
      />
      <button type="submit" className="amb-send" disabled={!text.trim()} aria-label={send}>
        <ArrowUp size={14} strokeWidth={2} aria-hidden />
      </button>
    </form>
  );
}
