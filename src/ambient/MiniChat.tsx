// One bot's chat, small: its newest messages (scrollable, the newest at the bottom), what it is doing now, any ask it
// waits on answered in place, and a field to reply that sends through the app's own send path, so the message lands in
// the real chat. The dock's card and an opened row of the island both show it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, ExternalLink, Square, X } from "lucide-react";
import { isBusy, shortAgo } from "./mood";
import { Reveal, TextField, rowLine, trayFor } from "./rows";
import { say, type AmbientLabels } from "./say";
import { FADE, SETTLE } from "./shared";
import type { AmbientAct, AmbientBot } from "./types";

/** The message list stops growing at this height and scrolls. */
export const CHAT_MAX_H = 232;

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
}

export function MiniChat({ bot, labels, lang, now, sent, fresh, onAct, onOpen, onPin, onDismiss }: MiniChatProps) {
  const reduced = useReducedMotion() === true;
  const [field, setField] = useState<"reply" | "answer" | null>(null);
  const busy = isBusy(bot.status);
  const ask = bot.status === "needs-you" && !sent;
  useEffect(() => { if (field === "answer" && !bot.question?.custom) setField(null); }, [field, bot.question]);
  const chat = bot.chat ?? [];
  const time = bot.status === "idle" || busy ? "" : shortAgo(bot.at, now, lang, say(labels, "now"));
  const status = sent ? say(labels, "sent") : bot.status === "idle" ? "" : say(labels, bot.status);
  const tray = ask ? trayFor(bot, labels, field === "reply" ? null : field, setField, onAct, onOpen, onPin) : null;
  // what a working bot is doing now, under its last message; a failure says so there too
  const doing = busy ? (bot.detail && bot.detail !== say(labels, bot.status) ? bot.detail : say(labels, bot.status)) : "";
  const failed = bot.status === "error" && bot.line && !chat.some((message) => message.text === bot.line) ? bot.line : "";

  // the newest at the bottom: follow it as messages arrive, unless the person scrolled up to read
  const list = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);
  const last = chat.at(-1);
  useLayoutEffect(() => {
    const node = list.current;
    if (node && pinnedToEnd.current) node.scrollTop = node.scrollHeight;
  }, [bot.id, last?.id, last?.text, doing]);
  useLayoutEffect(() => { pinnedToEnd.current = true; }, [bot.id]);

  return (
    <div className="amb-chat" data-status={bot.status}>
      <header className="amb-chat-head">
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
          <button type="button" className="amb-icon" aria-label={say(labels, "open", { name: bot.name })} title={say(labels, "openShort")} onClick={onOpen}>
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
          </button>
        </span>
      </header>
      {(chat.length > 0 || doing || failed) && (
        <div
          ref={list}
          className="amb-chat-list"
          style={{ maxHeight: CHAT_MAX_H }}
          role="log"
          aria-label={bot.name}
          onScroll={(event) => {
            const node = event.currentTarget;
            pinnedToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
          }}
        >
          <AnimatePresence initial={false}>
            {chat.map((message) => (
              <motion.p
                key={message.id}
                className="amb-bubble-msg"
                data-from={message.from}
                dir="auto"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { opacity: FADE, y: SETTLE } }}
              >
                {message.text}
              </motion.p>
            ))}
          </AnimatePresence>
          {failed && <p className="amb-chat-note" data-kind="error"><CircleAlert size={12} strokeWidth={2} aria-hidden />{failed}</p>}
          {doing && <p className="amb-chat-note" data-kind="busy"><span className="amb-row-words">{doing}</span></p>}
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
          onSend={(text) => onAct({ kind: "reply", botId: bot.id, threadId: bot.threadId, text })}
        />
      </div>
    </div>
  );
}
