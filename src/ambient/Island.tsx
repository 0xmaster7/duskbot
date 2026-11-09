// The notch island: black around the camera (or a floating pill on a display without a notch), the bot it is about on
// the left and the team's mood as an emoji on the right, only for what happens out of sight: what the person is watching
// in the app never shows here, and a change has to hold a moment before it does. Under the pointer it grows into a panel of every bot, on one spring: its width, height, corners and the two
// flares where it meets the top of the screen all ride it. Each row answers its bot's ask in place, or stops it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, useTransform } from "motion/react";
import { ChevronLeft, Plus } from "lucide-react";
import { CELEBRATE_MS, MOOD_EMOJI, finishedSince, isBusy, moodOf, rankBots, waitingCount, type Mood } from "./mood";
import { MiniChat } from "./MiniChat";
import { BotRow, useHoverBand, useRowMoments } from "./rows";
import { attention, eventKey, isFresh, isSeenEvent, useSeen } from "./seen";
import { say, type AmbientLabels } from "./say";
import { BotMark, EASE_OUT, FADE, FADE_OUT, HOLD_MS, ISLAND_EXIT, useSettledSignal, LIVELY, SETTLE, SETTLE_MS, useAllClear, useSteady, useSurfaceValue, useAmbientFeed, useChangeMoment, useNow, usePointerRegion, useStill } from "./shared";
import type { AmbientAct, AmbientBot, AmbientBridge, IslandLayout } from "./types";

const PANEL_W = 432;
/** The flares where a notch island meets the top edge of the screen. */
const EAR = 10;
/** The island stays this long after the pointer leaves, and keeps a little margin around it while open. */
const HOVER_OUT_MS = 150;
const GRACE = 16;
/** Longer than the island takes to fold away. */
const CHAT_RESET_MS = 450;
/** The island widens this much for a moment when someone starts needing the person, or a turn finishes. */
const NUDGE = 22;
const NUDGE_MS = 1600;
/** Everything answered or seen: the island smiles this long, then shrinks back to the bare notch. */
export const SMILE_MS = 2400;
const FALLBACK: IslandLayout["collapsed"] = { kind: "pill", width: 208, height: 34, top: 6, notch: 0 };

export interface IslandProps {
  bridge: AmbientBridge;
  /** Drawn inside a page (the setup's showcase), not in its own window: the pointer is measured from the island's stage,
   * and the window losing focus means nothing. */
  embedded?: boolean;
  /** Holds the panel open, as a showcase does. */
  forceOpen?: boolean;
}

export function Island({ bridge, embedded = false, forceOpen = false }: IslandProps) {
  const { snapshot, layout } = useAmbientFeed(bridge);
  const island = layout?.surface === "island" ? layout : null;
  const reduced = useReducedMotion() === true;
  const bots = snapshot?.bots ?? [];
  const labels = snapshot?.labels ?? {};
  const lang = snapshot?.lang ?? "";

  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned || forceOpen;
  // a reply or failure the person has seen anywhere stops asking for their attention here
  const { seen, mark } = useSeen(bridge, bots, open);
  useSettledSignal(bridge, open);
  const live = attention(bots, seen);
  const [celebrating, setCelebrating] = useState(false);
  const [nudged, setNudged] = useState(false);
  const before = useRef<readonly AmbientBot[] | null>(null);
  const cheer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    // a turn the person watched end in the app is no news here
    const outOfSight = bots.filter((bot) => !bot.quiet);
    const finished = finishedSince(before.current, outOfSight);
    before.current = outOfSight;
    if (!finished.length) return;
    setCelebrating(true);
    clearTimeout(cheer.current);
    cheer.current = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
  }, [bots]);
  useEffect(() => () => clearTimeout(cheer.current), []);

  // with nothing left to see and nobody busy, a smile for a moment, then only the notch
  const busyOrNews = useSteady(String(live.some((bot) => bot.status !== "idle"))) === "true";
  const { smiling, cheer: allClear } = useAllClear(busyOrNews, SMILE_MS);
  const minimal = !busyOrNews && !smiling && !celebrating;
  const mood = useSteady(moodOf(live, celebrating)) as Mood;
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
  const restW = minimal ? (notch ? c.notch : c.height + 20) : c.width + (nudged && !reduced ? NUDGE : 0);
  const targetW = open ? panelW : restW;
  const targetH = open ? openH : c.height;

  const w = useSurfaceValue(targetW, reduced, undefined, ISLAND_EXIT);
  const h = useSurfaceValue(targetH, reduced, undefined, ISLAND_EXIT);

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
  const stage = useRef<HTMLDivElement>(null);
  // open, a little margin around it still counts: brushing its edge does not fold it away
  const openNow = useRef(open);
  openNow.current = open;
  const hit = useCallback((x: number, y: number) => {
    const grace = openNow.current ? GRACE : 0;
    const half = w.get() / 2 + (notch ? EAR : 0) + 2 + grace;
    return Math.abs(x - stageW / 2) <= half && y >= c.top - 2 && y <= c.top + h.get() + 4 + grace;
  }, [w, h, notch, stageW, c.top]);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hovering = usePointerRegion(bridge, hit, () => {
    clearTimeout(leaveTimer.current);
    setHovered(true);
  }, () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(false), HOVER_OUT_MS);
  }, embedded ? { ref: stage, width: stageW } : undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  // a click anywhere else (the window loses focus) puts the island away, fields and all
  useEffect(() => {
    if (embedded) return;
    const blur = () => { setPinned(false); if (!hovering.current) setHovered(false); };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [hovering, embedded]);

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

  // while the person is elsewhere the mark holds still, except open, or for a moment after it changes
  const still = useStill(bridge);
  // the most important thing worth a glance, held steady: no taking turns, no swapping on every blip
  const focusId = useSteady(rankBots(live.filter((bot) => bot.status !== "idle"))[0]?.id ?? "", SETTLE_MS, HOLD_MS);
  const focus = live.find((bot) => bot.id === focusId && bot.status !== "idle") ?? null;
  // all clear: a smile, not the finish's party
  const emoji = minimal ? null : MOOD_EMOJI[smiling ? "idle" : mood];
  const changed = useChangeMoment(focus ? `${focus.id}:${focus.status}` : "");
  const moving = !still || open || changed || celebrating;
  // the compact island shows the most urgent; this many more wait behind it
  const more = Math.max(0, waitingCount(live) - 1);
  const islandLabel = more ? `${say(labels, "island")}, ${say(labels, "more", { count: more })}` : say(labels, "island");
  const close = () => { setPinned(false); setHovered(false); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };

  return (
    <div ref={stage} className="amb-stage" data-open={open || undefined} style={{ width: stageW, height: stageH }} onKeyDown={onKeyDown}>
      {notch && (
        <>
          <motion.div aria-hidden className="amb-ear amb-ear-left" style={{ x: leftEar, width: EAR, height: EAR }} />
          <motion.div aria-hidden className="amb-ear amb-ear-right" style={{ x: rightEdge, width: EAR, height: EAR }} />
        </>
      )}
      <motion.section
        className="amb-island"
        data-kind={c.kind}
        data-open={open || undefined}
        aria-label={say(labels, "island")}
        style={{ left: (stageW - panelW) / 2, top: c.top, width: panelW, height: maxH, clipPath: clip }}
      >
        {/* only while closed: open, the panel's own controls take over, and nothing outlines the notch */}
        {!open && (
          <button
            type="button"
            className="amb-island-hit"
            aria-expanded={false}
            aria-label={islandLabel}
            style={{ height: c.height, left: (panelW - c.width) / 2, width: c.width }}
            onClick={() => setHovered(true)}
          />
        )}
        <motion.div
          className="amb-panel"
          inert={!open}
          style={{ paddingTop: c.height }}
          initial={false}
          animate={open ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : -6 }}
          transition={open ? { opacity: { ...FADE, delay: 0.05 }, y: SETTLE } : { opacity: { duration: 0.12, ease: EASE_OUT }, y: ISLAND_EXIT }}
        >
          <div ref={panel}>
            <PanelBody bots={bots} seen={seen} mark={mark} cheer={allClear} labels={labels} lang={lang} open={open} bridge={bridge} onPin={setPinned} />
          </div>
        </motion.div>
      </motion.section>
      {focus && !minimal && (
        <motion.div className="amb-compact amb-compact-tile" style={{ x: tileX, top: c.top + (c.height - tile) / 2, width: tile, height: tile }}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={focus.id}
              className="amb-compact-mark"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 6, filter: "blur(3px)" }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              exit={reduced ? { opacity: 0, transition: FADE_OUT } : { opacity: 0, scale: 0.9, y: -4, filter: "blur(3px)", transition: FADE_OUT }}
              transition={{ opacity: FADE, filter: FADE, scale: LIVELY, y: LIVELY }}
            >
              <BotMark bot={focus} size={tile} state={celebrating ? "celebrate" : undefined} animated={moving && (isBusy(focus.status) || focus.status === "needs-you" || celebrating)} />
            </motion.span>
          </AnimatePresence>
          {more > 0 && <span className="amb-more" aria-hidden>+{more}</span>}
        </motion.div>
      )}
      <motion.div className="amb-compact amb-emoji" aria-live="polite" style={{ x: emojiX, top: c.top + (c.height - tile) / 2, width: tile, height: tile, fontSize: Math.round(tile * 0.86) }}>
        <AnimatePresence initial={false} mode="popLayout">
          {emoji && <motion.span
            key={emoji}
            className="amb-emoji-glyph"
            role="img"
            aria-label={say(labels, smiling ? "quiet" : mood === "celebrate" ? "done" : mood)}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: 6, filter: "blur(3px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0, transition: FADE_OUT } : { opacity: 0, scale: 0.96, filter: "blur(4px)", transition: FADE_OUT }}
            transition={{ opacity: FADE, filter: FADE, scale: LIVELY, y: LIVELY }}
          >
            {emoji}
          </motion.span>}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

type CountKey = "needs-you" | "working" | "done";

function countsOf(bots: AmbientBot[]): Partial<Record<CountKey, number>> {
  const counts: Partial<Record<CountKey, number>> = {};
  for (const bot of bots) {
    const key = bot.status === "needs-you" ? "needs-you" : isBusy(bot.status) ? "working" : bot.status === "done" ? "done" : null;
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function PanelBody({ bots, seen, mark, cheer, labels, lang, open, bridge, onPin }: {
  bots: readonly AmbientBot[]; seen: ReadonlySet<string>; mark: (keys: string[]) => void; cheer: number; labels: AmbientLabels; lang: string; open: boolean;
  bridge: AmbientBridge; onPin: (pinned: boolean) => void;
}) {
  const now = useNow(open);
  const live = attention(bots, seen);
  // every bot, the ones that need the person first, then failures, the busy, replies, and the resting ones
  const all = rankBots(live);
  const quiet = bots.length > 0 && all.every((bot) => bot.status === "idle");
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const counts = countsOf(live);
  const { sent, cheering, markSent } = useRowMoments(bots);
  // the same one highlight as the dock's, gliding from row to row
  const list = useRef<HTMLUListElement>(null);
  const band = useHoverBand(list, open, all.map((bot) => bot.id).join(","));
  const openChat = (bot: AmbientBot) => {
    if (isFresh(bot, seen)) mark([eventKey(bot)]);
    bridge.open(bot.id, bot.threadId);
  };
  // a row opens into that bot's mini chat, right here: its newest messages, a reply field, its ask; one at a time
  const [chatWith, setChatWith] = useState<string | null>(null);
  // back to every bot only once the island has finished folding away, so nothing swaps while it closes
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setChatWith(null), CHAT_RESET_MS);
    return () => clearTimeout(timer);
  }, [open]);
  const look = (bot: AmbientBot) => {
    if (isFresh(bot, seen)) mark([eventKey(bot)]);
    setChatWith((was) => (was === bot.id ? null : bot.id));
  };
  const chat = (bot: AmbientBot) => (
    <motion.div key={bot.id} className="amb-island-chat" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { opacity: FADE, y: SETTLE } }}>
      <button type="button" className="amb-back" aria-label={say(labels, "island")} title={say(labels, "island")} onClick={() => setChatWith(null)}>
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
      </button>
      <MiniChat
        bot={bot}
        labels={labels}
        lang={lang}
        now={now}
        sent={sent.has(bot.id)}
        fresh={isFresh(bot, seen) && !bot.quiet}
        onAct={(next) => act(bot, next)}
        onOpen={() => openChat(bot)}
        onPin={onPin}
        onDismiss={() => mark([eventKey(bot)])}
      />
    </motion.div>
  );
  const chatBot = chatWith ? bots.find((bot) => bot.id === chatWith) ?? null : null;
  const act = (bot: AmbientBot, next: AmbientAct) => {
    if (next.kind === "answer" || next.kind === "allow" || next.kind === "deny") markSent(bot);
    bridge.act(next);
  };
  return (
    <div className="amb-panel-body">
      <header className="amb-head">
        <div className="amb-counts" aria-live="polite">
          {(["needs-you", "working", "done"] as const).map((key) => counts[key] ? (
            <span key={key} className="amb-count" data-status={key}>
              <span className="amb-dot" aria-hidden />
              {say(labels, key)}
              <span className="amb-num">{counts[key]}</span>
            </span>
          ) : null)}
          {quiet && <span className="amb-count" data-status="idle">{say(labels, "quiet")}</span>}
        </div>
        <button type="button" className="amb-icon" aria-label={say(labels, "newBot")} title={say(labels, "newBot")} onClick={() => bridge.act({ kind: "new-bot" })}>
          <Plus size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      {chatBot ? chat(chatBot) : bots.length === 0 ? (
        <div className="amb-empty">
          <p className="amb-empty-title">{say(labels, "empty")}</p>
          <p className="amb-empty-hint">{say(labels, "emptyHint")}</p>
          <button type="button" className="amb-pill amb-pill-primary" onClick={() => bridge.act({ kind: "new-bot" })}>{say(labels, "newBot")}</button>
        </div>
      ) : (
        <ul ref={list} className="amb-rows" onPointerLeave={() => band.point(null)}>
          {band.element}
          {all.map((shown, index) => {
            const bot = byId.get(shown.id) ?? shown;
            // its real status here, even one the person is watching in the app; a reply or failure already seen is muted
            const recent = isSeenEvent(bot, seen);
            return (
              <li key={bot.id} data-row={bot.id} onPointerEnter={() => band.point(bot.id)} onPointerMove={() => band.point(bot.id)}>
                <BotRow
                  bot={bot}
                  labels={labels}
                  lang={lang}
                  now={now}
                  side="island"
                  open={open}
                  sent={sent.has(bot.id)}
                  recent={recent}
                  mascot={(
                    <button type="button" className="amb-row-open" aria-label={say(labels, "open", { name: bot.name })} title={say(labels, "openShort")} onClick={() => openChat(bot)}>
                      <BotMark bot={bot} size={30} state={cheering.has(bot.id) ? "celebrate" : sent.has(bot.id) ? "approving" : undefined} animated={open} awake={open} shown={open} index={index} cheer={cheer} />
                    </button>
                  )}
                  onOpen={() => look(bot)}
                  onAct={(next) => act(bot, next)}
                  onPin={onPin}
                  onDismiss={() => mark([eventKey(bot)])}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

