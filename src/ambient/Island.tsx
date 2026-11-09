// The notch island: black around the camera (or a floating pill on a display without a notch), the bot it is about on
// the left and the team's mood as an emoji on the right. Under the pointer it grows into a panel of every bot, on one
// spring: its width, height, corners and the two flares where it meets the top of the screen all ride it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowUp, CornerUpLeft, Plus, Square } from "lucide-react";
import { CELEBRATE_MS, MOOD_EMOJI, finishedSince, focusBot, isBusy, moodOf, rankBots, shortAgo, waitingCount, type Mood } from "./mood";
import { say, type AmbientLabels } from "./say";
import { BotMark, FADE, FADE_OUT, LIVELY, SETTLE, StatusTag, useAmbientFeed, useChangeMoment, useNow, usePointerRegion, useStill } from "./shared";
import type { AmbientBot, AmbientBridge, IslandLayout } from "./types";

const PANEL_W = 432;
/** The flares where a notch island meets the top edge of the screen. */
const EAR = 10;
const HOVER_IN_MS = 90;
const HOVER_OUT_MS = 260;
/** The island widens this much for a moment when someone starts needing the person, or a turn finishes. */
const NUDGE = 22;
const NUDGE_MS = 1600;
const FALLBACK: IslandLayout["collapsed"] = { kind: "pill", width: 208, height: 34, top: 6, notch: 0 };

export function Island({ bridge }: { bridge: AmbientBridge }) {
  const { snapshot, layout } = useAmbientFeed(bridge);
  const island = layout?.surface === "island" ? layout : null;
  const reduced = useReducedMotion() === true;
  const bots = snapshot?.bots ?? [];
  const labels = snapshot?.labels ?? {};
  const lang = snapshot?.lang ?? "";

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [nudged, setNudged] = useState(false);
  const before = useRef<AmbientBot[] | null>(null);
  const cheer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const finished = finishedSince(before.current, bots);
    before.current = bots;
    if (!finished.length) return;
    setCelebrating(true);
    clearTimeout(cheer.current);
    cheer.current = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
  }, [bots]);
  useEffect(() => () => clearTimeout(cheer.current), []);

  const mood = moodOf(bots, celebrating);
  const lastMood = useRef<Mood>(mood);
  useEffect(() => {
    const was = lastMood.current;
    lastMood.current = mood;
    if (was === mood || (mood !== "needs-you" && mood !== "celebrate")) return;
    setNudged(true);
    const timer = setTimeout(() => setNudged(false), NUDGE_MS);
    return () => clearTimeout(timer);
  }, [mood]);

  const c = island?.collapsed ?? FALLBACK;
  const notch = c.kind === "notch";
  const stageW = island?.width ?? 560;
  const stageH = island?.height ?? 500;
  const panelW = Math.max(PANEL_W, c.width + 48);
  const maxH = stageH - c.top - 20;
  const [contentH, setContentH] = useState(0);
  const openH = Math.min(maxH, c.height + contentH);
  const targetW = open ? panelW : c.width + (nudged && !reduced ? NUDGE : 0);
  const targetH = open ? openH : c.height;

  const w = useSpring(targetW, SETTLE);
  const h = useSpring(targetH, SETTLE);
  useEffect(() => { if (reduced) w.jump(targetW); else w.set(targetW); }, [targetW, reduced, w]);
  useEffect(() => { if (reduced) h.jump(targetH); else h.set(targetH); }, [targetH, reduced, h]);

  const closedR = notch ? Math.min(14, Math.round(c.height * 0.38)) : c.height / 2;
  const openR = notch ? 26 : 24;
  const r = useTransform(h, [c.height, Math.max(c.height + 1, openH)], [closedR, openR], { clamp: true });
  const clip = useTransform(() => {
    const side = Math.max(0, (panelW - w.get()) / 2);
    const bottom = Math.max(0, maxH - h.get());
    const round = r.get();
    return `inset(0px ${side}px ${bottom}px ${side}px round ${notch ? 0 : round}px ${notch ? 0 : round}px ${round}px ${round}px)`;
  });
  const leftEdge = useTransform(w, (value) => stageW / 2 - value / 2);
  const rightEdge = useTransform(w, (value) => stageW / 2 + value / 2);
  const leftEar = useTransform(leftEdge, (value) => value - EAR);
  const tile = island?.tile ?? 20;
  const inset = notch ? 12 : Math.max(6, Math.round((c.height - tile) / 2) + 1);
  const tileX = useTransform(leftEdge, (value) => value + inset);
  const emojiX = useTransform(rightEdge, (value) => value - inset - tile);

  // where the island is right now, mid-spring included: only there do clicks land
  const hit = useCallback((x: number, y: number) => {
    const half = w.get() / 2 + (notch ? EAR : 0) + 2;
    return Math.abs(x - stageW / 2) <= half && y >= c.top - 2 && y <= c.top + h.get() + 4;
  }, [w, h, notch, stageW, c.top]);
  const enterTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const hovering = usePointerRegion(bridge, hit, () => {
    clearTimeout(leaveTimer.current);
    enterTimer.current = setTimeout(() => setOpen(true), reduced ? 0 : HOVER_IN_MS);
  }, () => {
    clearTimeout(enterTimer.current);
    if (pinnedRef.current) return;
    leaveTimer.current = setTimeout(() => setOpen(false), HOVER_OUT_MS);
  });
  useEffect(() => () => { clearTimeout(enterTimer.current); clearTimeout(leaveTimer.current); }, []);
  // a click anywhere else (the window loses focus) puts the island away, reply field and all
  useEffect(() => {
    const blur = () => { setPinned(false); if (!hovering.current) setOpen(false); };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [hovering]);

  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const measure = () => setContentH(Math.ceil(node.scrollHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const focus = focusBot(bots);
  const emoji = MOOD_EMOJI[mood];
  // while the person is elsewhere the mark holds still, except open, or for a moment after it changes
  const still = useStill(bridge);
  const changed = useChangeMoment(focus ? `${focus.id}:${focus.status}` : "");
  const moving = !still || open || changed || celebrating;
  // the compact island shows the most urgent; this many more wait behind it
  const more = Math.max(0, waitingCount(bots) - 1);
  const islandLabel = more ? `${say(labels, "island")}, ${say(labels, "more", { count: more })}` : say(labels, "island");
  const close = () => { setPinned(false); setOpen(false); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };

  return (
    <div className="amb-stage" style={{ width: stageW, height: stageH }} onKeyDown={onKeyDown}>
      {notch && (
        <>
          <motion.div aria-hidden className="amb-ear amb-ear-left" style={{ x: leftEar, width: EAR, height: EAR }} />
          <motion.div aria-hidden className="amb-ear amb-ear-right" style={{ x: rightEdge, width: EAR, height: EAR }} />
        </>
      )}
      <motion.section
        className="amb-island"
        data-kind={c.kind}
        aria-label={say(labels, "island")}
        style={{ left: (stageW - panelW) / 2, top: c.top, width: panelW, height: maxH, clipPath: clip }}
      >
        <button
          type="button"
          className="amb-island-hit"
          aria-expanded={open}
          aria-label={islandLabel}
          style={{ height: c.height, left: (panelW - c.width) / 2, width: c.width }}
          onClick={() => setOpen(true)}
        />
        <motion.div
          className="amb-panel"
          inert={!open}
          style={{ paddingTop: c.height }}
          initial={false}
          animate={open ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : -6 }}
          transition={open ? { opacity: { ...FADE, delay: 0.05 }, y: SETTLE } : { opacity: FADE_OUT, y: FADE_OUT }}
        >
          <div ref={panel}>
            <PanelBody bots={bots} labels={labels} lang={lang} open={open} bridge={bridge} onPin={setPinned} onSent={close} />
          </div>
        </motion.div>
      </motion.section>
      {focus && (
        <motion.div className="amb-compact amb-compact-tile" style={{ x: tileX, top: c.top + (c.height - tile) / 2, width: tile, height: tile }}>
          <BotMark bot={focus} size={tile} state={celebrating ? "celebrate" : undefined} animated={moving && (isBusy(focus.status) || focus.status === "needs-you" || celebrating)} />
          {more > 0 && <span className="amb-more" aria-hidden>+{more}</span>}
        </motion.div>
      )}
      <motion.div className="amb-compact amb-emoji" aria-live="polite" style={{ x: emojiX, top: c.top + (c.height - tile) / 2, width: tile, height: tile, fontSize: Math.round(tile * 0.86) }}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={emoji}
            className="amb-emoji-glyph"
            role="img"
            aria-label={say(labels, mood === "celebrate" ? "done" : mood === "needs-you" ? "needs-you" : mood)}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: 6, filter: "blur(3px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0, transition: FADE_OUT } : { opacity: 0, scale: 0.96, filter: "blur(4px)", transition: FADE_OUT }}
            transition={{ opacity: FADE, filter: FADE, scale: LIVELY, y: LIVELY }}
          >
            {emoji}
          </motion.span>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

type Counts = Partial<Record<"needs-you" | "busy" | "done" | "error", number>>;

function countsOf(bots: AmbientBot[]): Counts {
  const counts: Counts = {};
  for (const bot of bots) {
    const key = bot.status === "needs-you" ? "needs-you" : isBusy(bot.status) ? "busy" : bot.status === "done" ? "done" : bot.status === "error" ? "error" : null;
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function PanelBody({ bots, labels, lang, open, bridge, onPin, onSent }: {
  bots: AmbientBot[]; labels: AmbientLabels; lang: string; open: boolean; bridge: AmbientBridge; onPin: (pinned: boolean) => void; onSent: () => void;
}) {
  const now = useNow(open);
  const [replying, setReplying] = useState<string | null>(null);
  useEffect(() => { if (!open) setReplying(null); }, [open]);
  const ranked = rankBots(bots);
  const quiet = bots.length > 0 && bots.every((bot) => bot.status === "idle");
  const counts = countsOf(bots);
  const openChat = (bot: AmbientBot) => bridge.open(bot.id, bot.threadId);
  return (
    <div className="amb-panel-body">
      <header className="amb-head">
        <div className="amb-counts">
          {(["needs-you", "busy", "done"] as const).map((key) => counts[key] ? (
            <span key={key} className="amb-count" data-status={key}>
              <span className="amb-dot" aria-hidden />
              {say(labels, key === "busy" ? "working" : key)}
              <span className="amb-num">{counts[key]}</span>
            </span>
          ) : null)}
          {quiet && <span className="amb-count" data-status="idle">{say(labels, "quiet")}</span>}
        </div>
        <button type="button" className="amb-icon" aria-label={say(labels, "newBot")} title={say(labels, "newBot")} onClick={() => bridge.act({ kind: "new-bot" })}>
          <Plus size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      {bots.length === 0 ? (
        <div className="amb-empty">
          <p className="amb-empty-title">{say(labels, "empty")}</p>
          <p className="amb-empty-hint">{say(labels, "emptyHint")}</p>
          <button type="button" className="amb-pill amb-pill-primary" onClick={() => bridge.act({ kind: "new-bot" })}>{say(labels, "newBot")}</button>
        </div>
      ) : quiet ? (
        <Shelf bots={ranked} labels={labels} open={open} onOpen={openChat} />
      ) : (
        <ul className="amb-rows">
          {ranked.map((bot) => (
            <Row
              key={bot.id}
              bot={bot}
              labels={labels}
              lang={lang}
              now={now}
              open={open}
              replying={replying === bot.id}
              onToggleReply={() => setReplying((was) => (was === bot.id ? null : bot.id))}
              onOpen={() => openChat(bot)}
              onAct={(act) => bridge.act(act)}
              onPin={onPin}
              onSent={() => { setReplying(null); onSent(); }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ bot, labels, lang, now, open, replying, onToggleReply, onOpen, onAct, onPin, onSent }: {
  bot: AmbientBot; labels: AmbientLabels; lang: string; now: number; open: boolean; replying: boolean;
  onToggleReply: () => void; onOpen: () => void; onAct: AmbientBridge["act"]; onPin: (pinned: boolean) => void; onSent: () => void;
}) {
  const busy = isBusy(bot.status);
  const question = bot.status === "needs-you" ? bot.question : null;
  const approval = question ? null : bot.approval;
  // "Thinking" next to the status "Thinking" says nothing: the newest line does
  const detail = bot.detail && bot.detail !== say(labels, bot.status) ? bot.detail : "";
  const line = question?.title || ((busy || bot.status === "needs-you") && detail ? (approval?.title ? `${detail}: ${approval.title}` : detail) : bot.line);
  return (
    <li className="amb-row" data-status={bot.status}>
      <button type="button" className="amb-row-main" onClick={onOpen} aria-label={say(labels, "open", { name: bot.name })}>
        <span className="amb-row-mark"><BotMark bot={bot} size={30} animated={open && (busy || bot.status === "needs-you")} /></span>
        <span className="amb-row-text">
          <span className="amb-row-top">
            <span className="amb-row-name">{bot.name}</span>
            <StatusTag status={bot.status} labels={labels} />
            <span className="amb-row-time">{shortAgo(bot.at, now, lang, say(labels, "now"))}</span>
          </span>
          {line && <span className="amb-row-line" dir="auto">{line}</span>}
        </span>
      </button>
      <div className="amb-row-actions">
        {approval ? (
          <>
            <button type="button" className="amb-pill amb-pill-primary" onClick={() => onAct({ kind: "allow", botId: bot.id, threadId: approval.threadId, requestId: approval.requestId })}>{say(labels, "allow")}</button>
            <button type="button" className="amb-pill" onClick={() => onAct({ kind: "deny", botId: bot.id, threadId: approval.threadId, requestId: approval.requestId })}>{say(labels, "deny")}</button>
          </>
        ) : (
          <>
            {busy && (
              <button type="button" className="amb-icon" aria-label={say(labels, "stop", { name: bot.name })} title={say(labels, "stop", { name: bot.name })} onClick={() => onAct({ kind: "stop", botId: bot.id, threadId: bot.threadId })}>
                <Square size={11} strokeWidth={2} fill="currentColor" aria-hidden />
              </button>
            )}
            <button type="button" className="amb-icon" data-on={replying || undefined} aria-expanded={replying} aria-label={say(labels, "replyTo", { name: bot.name })} title={say(labels, "reply")} onClick={onToggleReply}>
              <CornerUpLeft size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </>
        )}
      </div>
      {question && (
        <div className="amb-choices" role="group" aria-label={question.title}>
          {question.choices.map((choice) => (
            <button key={choice} type="button" className="amb-pill" onClick={() => onAct({ kind: "answer", botId: bot.id, threadId: question.threadId, requestId: question.requestId, text: choice })}>{choice}</button>
          ))}
        </div>
      )}
      {replying && <ReplyField bot={bot} labels={labels} onPin={onPin} onSend={(text) => { onAct({ kind: "reply", botId: bot.id, threadId: bot.threadId, text }); onSent(); }} />}
    </li>
  );
}

function ReplyField({ bot, labels, onPin, onSend }: { bot: AmbientBot; labels: AmbientLabels; onPin: (pinned: boolean) => void; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); onPin(true); return () => onPin(false); }, [onPin]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (message) onSend(message);
  };
  const label = say(labels, "replyTo", { name: bot.name });
  return (
    <form className="amb-reply" onSubmit={submit}>
      <input ref={input} className="amb-reply-input" value={text} onChange={(event) => setText(event.target.value)} aria-label={label} placeholder={label} maxLength={4000} autoComplete="off" spellCheck />
      <button type="submit" className="amb-send" disabled={!text.trim()} aria-label={say(labels, "send")}>
        <ArrowUp size={14} strokeWidth={2} aria-hidden />
      </button>
    </form>
  );
}

/** Nothing going on: the bots asleep on a shelf. Each one still opens its chat. */
function Shelf({ bots, labels, open, onOpen }: { bots: AmbientBot[]; labels: AmbientLabels; open: boolean; onOpen: (bot: AmbientBot) => void }) {
  return (
    <div className="amb-shelf">
      <div className="amb-shelf-bots">
        {bots.slice(0, 8).map((bot) => (
          <button key={bot.id} type="button" className="amb-shelf-bot" onClick={() => onOpen(bot)} aria-label={say(labels, "open", { name: bot.name })}>
            <BotMark bot={bot} size={34} state="sleeping" animated={open} />
            <span className="amb-shelf-name">{bot.name}</span>
          </button>
        ))}
      </div>
      <p className="amb-shelf-hint">{say(labels, "quietHint")}</p>
    </div>
  );
}
