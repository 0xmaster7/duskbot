// One bot's chat, small: its newest messages (scrollable, the newest at the bottom), what it is doing now, any ask it
// waits on answered in place, and a field to reply that sends through the app's own send path, so the message lands in
// the real chat. The dock's card and an opened row of the island both show it.
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Square, X } from "lucide-react";
import { isBusy, shortAgo } from "./mood";
import { Reveal, TextField, rowLine, trayFor } from "./rows";
import { say, type AmbientLabels } from "./say";
import { BotMark, FADE, SETTLE } from "./shared";
import type { AmbientAct, AmbientBot, AmbientMessage } from "./types";

/** The chat stops growing at this height (the list scrolls, the field stays at the bottom), unless told otherwise. */
export const CHAT_MAX_H = 520;

export interface MiniChatProps {
  bot: AmbientBot;
  labels: AmbientLabels;
  lang: string;
  now: number;
  /** Answered from here a moment ago: the ask shows as sent until the summary moves on. */
  sent: boolean;
  /** A fresh reply or failure: offers to put it away without opening the app. */
  fresh: boolean;
  onAct: (act: AmbientAct) => void;
  onOpen: () => void;
  onPin: (pinned: boolean) => void;
  onDismiss?: () => void;
  /** The whole chat's height at most; the messages scroll inside it. */
  maxHeight?: number;
  /** Near the top with older messages behind: ask for them. */
  onMore?: () => void;
  /** Where each bot's chat was scrolled to, kept by a surface that shows one bot after another in the same chat. */
  scrolls?: Map<string, ChatScroll>;
}

export interface ChatScroll {
  top: number;
  /** At the newest message, following what arrives. */
  end: boolean;
}

/** Messages a chat starts with, and how many more each scroll to the top brings. */
export const HISTORY = 60;
/** A sent message shows at once; it gives way to the chat's own copy when that arrives, or after this long. */
export const PENDING_MS = 15_000;
/** This near the top, the chat asks for older messages. */
const MORE_AT_PX = 48;

const plain = (text: string) => text.replace(/\s+/g, " ").trim();

interface Pending {
  id: string;
  botId: string;
  text: string;
  at: number;
  /** The chat's newest message when it was sent: its own copy arrives after that one. */
  after: string | undefined;
  /** Sent messages still on their way when it was sent: their copies come first. */
  ahead: number;
}

/** How many of the person's messages the chat holds after `after` (all of them when that one is gone or unknown). */
export function sentSince(chat: readonly AmbientMessage[], after: string | undefined): number {
  const from = after === undefined ? -1 : chat.findIndex((message) => message.id === after);
  let count = 0;
  for (let index = from + 1; index < chat.length; index++) if (chat[index]!.from === "you") count++;
  return count;
}

export function MiniChat({ bot, labels, lang, now, sent, fresh, maxHeight, onAct, onOpen, onPin, onDismiss, onMore, scrolls }: MiniChatProps) {
  const reduced = useReducedMotion() === true;
  // the field open for an ask belongs to the bot it was opened for: shown another bot, it starts closed
  const [fieldOf, setFieldOf] = useState<{ id: string; kind: "reply" | "answer" | null }>({ id: bot.id, kind: null });
  const field = fieldOf.id === bot.id ? fieldOf.kind : null;
  const setField = (kind: "reply" | "answer" | null) => setFieldOf({ id: bot.id, kind });
  const busy = isBusy(bot.status);
  const ask = bot.status === "needs-you" && !sent;
  useEffect(() => { if (field === "answer" && !bot.question?.custom) setFieldOf({ id: bot.id, kind: null }); }, [field, bot.question, bot.id]);
  const chat = bot.chat ?? [];
  const time = bot.status === "idle" || busy ? "" : shortAgo(bot.at, now, lang, say(labels, "now"));
  const status = sent ? say(labels, "sent") : say(labels, bot.status);
  const tray = ask ? trayFor(bot, labels, field === "reply" ? null : field, setField, onAct, onOpen, onPin) : null;
  // what a working bot is doing now, under its last message; a failure says so there too
  const doing = busy ? (bot.detail && bot.detail !== say(labels, bot.status) ? bot.detail : say(labels, bot.status)) : "";
  const failed = bot.status === "error" && bot.line && !chat.some((message) => message.text === bot.line) ? bot.line : "";
  const last = chat.at(-1);
  // the reply being written, until the chat's own copy of it lands (both can arrive in the same summary)
  const written = busy || bot.streaming ? bot.streaming ?? "" : "";
  const landed = Boolean(written && last?.from === "bot" && plain(last.text).startsWith(plain(written).slice(0, 60)));
  const streaming = landed ? "" : written;

  // what the person just sent shows at once, and gives way to the chat's own copy: the next message of theirs after
  // what the chat held when it was sent (its words may come back reformatted, so they are not compared)
  const [pendingAll, setPending] = useState<Pending[]>([]);
  // gone in the very render its copy arrives in, so the two never show together
  const waiting = (entry: Pending) => entry.botId !== bot.id || sentSince(chat, entry.after) <= entry.ahead;
  const pending = pendingAll.filter((entry) => entry.botId === bot.id && waiting(entry));
  useEffect(() => {
    if (!pendingAll.length) return;
    const left = pendingAll.filter((entry) => waiting(entry) && Date.now() - entry.at < PENDING_MS);
    if (left.length !== pendingAll.length) setPending(left);
    if (!left.length) return;
    const timer = setTimeout(() => setPending((was) => was.filter((entry) => Date.now() - entry.at < PENDING_MS)), PENDING_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, pendingAll, bot.id]);
  const send = (text: string) => {
    pinnedToEnd.current = true;
    const at = Date.now();
    setPending((was) => [...was, { id: `pending-${at}-${was.length}`, botId: bot.id, text, at, after: last?.id, ahead: was.filter((entry) => entry.botId === bot.id).length }]);
    onAct({ kind: "reply", botId: bot.id, threadId: bot.threadId, text });
  };

  // a message slides in only when it is new at the end of the chat already shown; one taking over from the sent copy
  // or the streamed reply, older ones loaded above, and another bot's chat appear as they are
  const shownAs = useRef<{ bot: string; last: string | undefined; pending: number; streaming: boolean }>({ bot: bot.id, last: last?.id, pending: 0, streaming: false });
  const was = shownAs.current;
  const enters = Boolean(last && was.bot === bot.id && was.last !== last.id && !(last.from === "you" ? was.pending : was.streaming));
  const entering = useRef<string | null>(null);
  if (enters) entering.current = last!.id;
  else if (was.bot !== bot.id) entering.current = null;
  useEffect(() => { shownAs.current = { bot: bot.id, last: last?.id, pending: pending.length, streaming: Boolean(streaming) }; });

  // the newest at the bottom: follow it as messages arrive and stream, unless the person scrolled up to read; older ones
  // added above keep the reading place where it was. Shown another bot, its chat comes back where the person left it
  // (or at the newest), before anything paints
  const list = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);
  const first = chat[0]?.id;
  const above = useRef<{ first: string | undefined; height: number }>({ first, height: 0 });
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) { scrolledFor.current = null; return; }
    if (scrolledFor.current !== bot.id) {
      scrolledFor.current = bot.id;
      const saved = scrolls?.get(bot.id);
      pinnedToEnd.current = !saved || saved.end;
      node.scrollTop = pinnedToEnd.current ? node.scrollHeight : saved!.top;
    } else if (pinnedToEnd.current) node.scrollTop = node.scrollHeight;
    else if (above.current.first !== first && above.current.height) node.scrollTop += node.scrollHeight - above.current.height;
    above.current = { first, height: node.scrollHeight };
  }, [bot.id, first, last?.id, last?.text, doing, streaming, pending.length, scrolls]);
  const asked = useRef<string | undefined>(undefined);

  return (
    <div className="amb-chat" data-status={bot.status} style={maxHeight ? { maxHeight } : undefined}>
      <header className="amb-chat-head">
        {/* only the bot itself opens its chat in the app; the rest of the card is for reading and answering here */}
        <button type="button" className="amb-chat-mascot" onClick={onOpen} aria-label={say(labels, "open", { name: bot.name })} title={say(labels, "openShort")}>
          <BotMark bot={bot} size={22} animated awake={false} />
        </button>
        <span className="amb-row-name">{bot.name}</span>
        {status && <span className="amb-chat-status" data-status={bot.status}>{sent && <Check size={11} strokeWidth={2.25} aria-hidden />}{status}</span>}
        {time && <span className="amb-row-time">{time}</span>}
        <span className="amb-chat-tools">
          {busy && (
            <button type="button" className="amb-icon" aria-label={say(labels, "stop", { name: bot.name })} title={say(labels, "stop", { name: bot.name })} onClick={() => onAct({ kind: "stop", botId: bot.id, threadId: bot.threadId })}>
              <Square size={10} strokeWidth={2} fill="currentColor" aria-hidden />
            </button>
          )}
          {fresh && onDismiss && (
            <button type="button" className="amb-icon" aria-label={`${say(labels, "dismiss")}: ${bot.name}`} title={say(labels, "dismiss")} onClick={onDismiss}>
              <X size={13} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </span>
      </header>
      {(chat.length > 0 || doing || failed || pending.length > 0 || streaming) && (
        <div
          ref={list}
          className="amb-chat-list"
          role="log"
          aria-label={bot.name}
          aria-busy={busy || undefined}
          tabIndex={0}
          onScroll={(event) => {
            const node = event.currentTarget;
            if (scrolledFor.current !== bot.id) return;
            pinnedToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
            scrolls?.set(bot.id, { top: node.scrollTop, end: pinnedToEnd.current });
            // near the top with more behind: the next older stretch, once per first message
            if (node.scrollTop < MORE_AT_PX && bot.hasMore && onMore && asked.current !== first) { asked.current = first; onMore(); }
          }}
        >
          {chat.map((message) => <Line key={message.id} from={message.from} text={message.text} enter={entering.current === message.id} reduced={reduced} />)}
          {pending.map((entry) => <Line key={entry.id} from="you" text={entry.text} pending enter reduced={reduced} />)}
          {failed && <p className="amb-chat-note" data-kind="error"><CircleAlert size={12} strokeWidth={2} aria-hidden />{failed}</p>}
          {/* its reply as it writes it, then what it is doing while it works on it */}
          {streaming && <p className="amb-bubble-msg" data-from="bot" data-streaming="" dir="auto" aria-live="polite">{streaming}</p>}
          {busy && !streaming && <p className="amb-chat-note amb-typing" data-kind="busy"><span className="amb-dots" aria-hidden><i /><i /><i /></span><span className="amb-row-words">{doing}</span></p>}
        </div>
      )}
      <AnimatePresence initial={false}>
        {tray && (
          <Reveal key="ask" className="amb-tray-wrap">
            <div className="amb-tray amb-chat-ask">
              <p className="amb-chat-ask-line" dir="auto">{rowLine(bot, labels).text}</p>
              {tray}
            </div>
          </Reveal>
        )}
      </AnimatePresence>
      <div className="amb-chat-compose">
        <TextField
          key={bot.id}
          label={say(labels, "replyTo", { name: bot.name })}
          send={say(labels, "send")}
          focus={false}
          onPin={onPin}
          onCancel={() => {}}
          onSend={send}
        />
      </div>
    </div>
  );
}

/** One message. Drawn again only when its own words change, never for each word a reply streams elsewhere. */
const Line = memo(function Line({ from, text, enter, pending = false, reduced }: { from: "you" | "bot"; text: string; enter: boolean; pending?: boolean; reduced: boolean }) {
  return (
    <motion.p
      className="amb-bubble-msg"
      data-from={from}
      data-pending={pending ? "" : undefined}
      dir="auto"
      initial={enter ? (reduced ? { opacity: 0 } : { opacity: 0, y: 6 }) : false}
      animate={{ opacity: 1, y: 0, transition: { opacity: FADE, y: SETTLE } }}
    >
      {text}
    </motion.p>
  );
});
