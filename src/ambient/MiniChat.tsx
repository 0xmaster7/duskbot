// One bot's chat, small: its newest messages (scrollable, the newest at the bottom), what it is doing now, any ask it
// waits on answered in place, and a field to reply that sends through the app's own send path, so the message lands in
// the real chat. The dock's card and an opened row of the island both show it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Square, X } from "lucide-react";
import { isBusy, shortAgo } from "./mood";
import { Reveal, TextField, rowLine, trayFor } from "./rows";
import { say, type AmbientLabels } from "./say";
import { BotMark, FADE, SETTLE } from "./shared";
import type { AmbientAct, AmbientBot } from "./types";

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
}

/** Messages a chat starts with, and how many more each scroll to the top brings. */
export const HISTORY = 40;
/** A sent message shows at once; it gives way to the chat's own copy when that arrives, or after this long. */
export const PENDING_MS = 15_000;
/** This near the top, the chat asks for older messages. */
const MORE_AT_PX = 48;

export function MiniChat({ bot, labels, lang, now, sent, fresh, maxHeight, onAct, onOpen, onPin, onDismiss, onMore }: MiniChatProps) {
  const reduced = useReducedMotion() === true;
  const [field, setField] = useState<"reply" | "answer" | null>(null);
  const busy = isBusy(bot.status);
  const ask = bot.status === "needs-you" && !sent;
  useEffect(() => { if (field === "answer" && !bot.question?.custom) setField(null); }, [field, bot.question]);
  const chat = bot.chat ?? [];
  const time = bot.status === "idle" || busy ? "" : shortAgo(bot.at, now, lang, say(labels, "now"));
  const status = sent ? say(labels, "sent") : say(labels, bot.status);
  const tray = ask ? trayFor(bot, labels, field === "reply" ? null : field, setField, onAct, onOpen, onPin) : null;
  // what a working bot is doing now, under its last message; a failure says so there too
  const doing = busy ? (bot.detail && bot.detail !== say(labels, bot.status) ? bot.detail : say(labels, bot.status)) : "";
  const failed = bot.status === "error" && bot.line && !chat.some((message) => message.text === bot.line) ? bot.line : "";
  const streaming = busy || bot.streaming ? bot.streaming ?? "" : "";

  // what the person just sent shows at once, before the chat's own copy comes back
  const [pending, setPending] = useState<Array<{ id: string; text: string; at: number }>>([]);
  useEffect(() => setPending([]), [bot.id]);
  useEffect(() => {
    if (!pending.length) return;
    const echoed = (entry: { text: string; at: number }) => chat.some((message) => message.from === "you" && message.text === entry.text.replace(/\s+/g, " ").trim() && message.at >= entry.at - 60_000);
    const left = pending.filter((entry) => !echoed(entry) && Date.now() - entry.at < PENDING_MS);
    if (left.length !== pending.length) setPending(left);
    const timer = setTimeout(() => setPending((was) => was.filter((entry) => Date.now() - entry.at < PENDING_MS)), PENDING_MS);
    return () => clearTimeout(timer);
  }, [chat, pending]);
  const send = (text: string) => {
    pinnedToEnd.current = true;
    setPending((was) => [...was, { id: `pending-${Date.now()}`, text, at: Date.now() }]);
    onAct({ kind: "reply", botId: bot.id, threadId: bot.threadId, text });
  };

  // the newest at the bottom: follow it as messages arrive and stream, unless the person scrolled up to read; older ones
  // added above keep the reading place where it was
  const list = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);
  const last = chat.at(-1);
  const first = chat[0]?.id;
  const above = useRef<{ first: string | undefined; height: number }>({ first, height: 0 });
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (pinnedToEnd.current) node.scrollTop = node.scrollHeight;
    else if (above.current.first !== first && above.current.height) node.scrollTop += node.scrollHeight - above.current.height;
    above.current = { first, height: node.scrollHeight };
  }, [bot.id, first, last?.id, last?.text, doing, streaming, pending.length]);
  useLayoutEffect(() => { pinnedToEnd.current = true; }, [bot.id]);
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
            pinnedToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
            // near the top with more behind: the next older stretch, once per first message
            if (node.scrollTop < MORE_AT_PX && bot.hasMore && onMore && asked.current !== first) { asked.current = first; onMore(); }
          }}
        >
          <AnimatePresence initial={false}>
            {chat.map((message) => (
              <motion.p
                key={message.id}
                className="amb-bubble-msg"
                data-from={message.from}
                dir="auto"
                initial={reduced || message.id !== last?.id ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { opacity: FADE, y: SETTLE } }}
              >
                {message.text}
              </motion.p>
            ))}
            {pending.map((entry) => (
              <motion.p key={entry.id} className="amb-bubble-msg" data-from="you" data-pending="" dir="auto" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { opacity: FADE, y: SETTLE } }}>
                {entry.text}
              </motion.p>
            ))}
          </AnimatePresence>
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
