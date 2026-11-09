// The bot dock: a slim black column of mascots against the right edge of the screen that flares into it at both ends.
// At rest only a sliver shows, ticked where a bot works, replied or waits. The pointer at the edge slides the column in;
// resting on a bot (or moving onto it) brings out one card beside the column with that bot's status, its ask answered
// right there. The card is one element for the whole visit: it glides and resizes from bot to bot and only goes once
// the pointer has left both. A mascot carries a bubble only for news: an ask, an unseen reply, an unseen failure.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, Reorder, motion, useDragControls, useReducedMotion, useTransform } from "motion/react";
import { Plus } from "lucide-react";
import { dockOrder, isBusy } from "./mood";
import { MiniChat } from "./MiniChat";
import { useRowMoments } from "./rows";
import { LOOK_MS, attention, eventKey, isFresh, isSeenEvent, useSeen } from "./seen";
import { say, type AmbientLabels } from "./say";
import { BotMark, EASE_OUT, FADE, FADE_OUT, LIVELY, SETTLE, SOFT_EXIT, useAllClear, useSettledSignal, useTraceTransitions, useAmbientFeed, useNow, usePointerRegion, useSurfaceValue } from "./shared";
import type { AmbientAct, AmbientBot, AmbientBridge, DockLayout } from "./types";

/** How near the right edge the pointer has to be, beside the body, to bring the dock in. */
const EDGE = 14;
/** Off the bots and the card, the card goes almost at once (a slip of the pointer is forgiven); the column follows a
 * good while later, so the two never vanish together. */
export const CARD_LEAVE_MS = 90;
export const HIDE_MS = 520;
/** This much around the card and the column still counts as on them, so heading back never closes anything. */
const GRACE = 16;
/** The first card of a visit waits for intent: resting on a bot this long, or moving this far on the column. */
export const DWELL_MS = 450;
const NUDGE_PX = 6;
/** A bot that starts needing the person, or fails, brings the dock out this long. */
const PEEK_MS = 3600;
const RADIUS = 22;
export const CARD_W = 304;
const CARD_GAP = 10;
const CARD_MARGIN = 8;
/** The card leaves quickly and smoothly, words and all: a fade with a touch of scale and drift. */
const CARD_OUT = { duration: 0.14, ease: EASE_OUT } as const;
/** Moving from bot to bot, the words swap fast through a blur while the card glides. */
const SWAP_IN = { duration: 0.14, ease: EASE_OUT } as const;
const SWAP_OUT = { duration: 0.08, ease: EASE_OUT } as const;
// one empty list for "nothing yet": a fresh [] each render would rerun the order effect forever
const NONE: readonly never[] = [];
const FALLBACK_DOCK: DockLayout["dock"] = { cell: 56, tile: 36, column: 64, open: 404, pad: 8, ear: 18, sliver: 6, margin: 28, overhang: 4 };

export function Dock({ bridge }: { bridge: AmbientBridge }) {
  const { snapshot, layout } = useAmbientFeed(bridge);
  const dock = layout?.surface === "dock" ? layout : null;
  const reduced = useReducedMotion() === true;
  const labels = snapshot?.labels ?? {};
  const bots: readonly AmbientBot[] = snapshot?.bots ?? NONE;
  const lang = snapshot?.lang ?? "";
  const d = dock?.dock ?? FALLBACK_DOCK;
  // the window runs past the screen's edge (ambient-geometry.mjs): the body paints into that strip, so no seam can show
  const over = d.overhang ?? 0;
  const stageW = dock?.width ?? d.open + over;
  const edge = stageW - over;
  const columnLeft = edge - d.column;
  const cardLeft = columnLeft - CARD_GAP - CARD_W;
  const stageH = dock?.height ?? 720;
  const maxBody = dock?.body ?? stageH - 2 * (d.ear + d.margin);

  const [ids, setIds] = useState<string[]>([]);
  const idsNow = useRef(ids);
  idsNow.current = ids;
  const dragging = useRef(false);
  const moved = useRef(false);
  useEffect(() => {
    if (dragging.current) return;
    setIds(dockOrder(bots, dock?.order ?? NONE).map((bot) => bot.id));
  }, [bots, dock?.order]);
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const shown = ids.map((id) => byId.get(id)).filter((bot): bot is AmbientBot => Boolean(bot));

  const [out, setOut] = useState(false);
  const [peek, setPeek] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  // the last bot the card showed, kept while it goes so its words leave with it
  const [lastCard, setLastCard] = useState<string | null>(null);
  useEffect(() => { if (card) setLastCard(card); }, [card]);
  const slidOut = out || peek || pinned || card !== null;

  const { seen, mark } = useSeen(bridge, bots, false);
  useSettledSignal(bridge, slidOut);
  // the dock's side of the trace: the column coming and going, the card showing a bot or leaving
  const traced = useRef({ slidOut: false, card: null as string | null });
  useEffect(() => {
    if (traced.current.slidOut !== slidOut) bridge.trace?.(slidOut ? "state-column-out" : "state-column-closing", `out=${out} peek=${peek} pinned=${pinned}`);
    if (traced.current.card !== card) bridge.trace?.(card ? "state-card" : "state-card-closing", card ? "a bot" : "");
    traced.current = { slidOut, card };
  }, [slidOut, card, out, peek, pinned, bridge]);
  // everything answered or seen: the whole column cheers once
  const { cheer } = useAllClear(attention(bots, seen).some((bot) => bot.status !== "idle"), 2400);

  // someone starts needing the person, or fails: the column comes out for a moment on its own, no card
  const calling = bots.filter((bot) => !bot.quiet && (bot.status === "needs-you" || (bot.status === "error" && isFresh(bot, seen)))).map((bot) => bot.id).join(",");
  const lastCalling = useRef<string | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!snapshot) return;
    const first = lastCalling.current === null;
    const before = new Set((lastCalling.current ?? "").split(",").filter(Boolean));
    lastCalling.current = calling;
    // the first summary is how things stand, not news
    if (first || !calling.split(",").some((id) => id && !before.has(id))) return;
    setPeek(true);
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(false), PEEK_MS);
  }, [calling, snapshot]);
  useEffect(() => () => clearTimeout(peekTimer.current), []);

  // the column is as tall as its bots, centred on the edge, and slides in from the right
  const content = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [contentH, setContentH] = useState(d.cell + 2 * d.pad);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const measure = () => setContentH(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const bodyH = Math.min(contentH, maxBody);
  const traceAs = (what: string) => (bridge.trace ? (event: string, detail?: string) => bridge.trace!(`${what}:${event}`, detail) : undefined);
  const h = useSurfaceValue(bodyH, reduced, undefined, undefined, traceAs("height"));
  const slide = useSurfaceValue(slidOut ? 0 : d.column - d.sliver, reduced, slidOut, SOFT_EXIT, traceAs("column"));
  useTraceTransitions(bridge);
  const top = useTransform(h, (value) => Math.round((stageH - value) / 2));
  const clip = useTransform(() => {
    const t = top.get();
    return `inset(${t}px 0px ${Math.max(0, stageH - t - h.get())}px ${Math.max(0, columnLeft)}px round ${RADIUS}px 0px 0px ${RADIUS}px)`;
  });
  const earTop = useTransform(top, (value) => value - d.ear);
  const earBottom = useTransform(() => top.get() + h.get());

  // the card: one element, placed beside the bot it shows and as tall as what it says
  const cardInner = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(64);
  useLayoutEffect(() => {
    const node = cardInner.current;
    if (!node) return;
    const measure = () => setCardH(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [anchor, setAnchor] = useState(stageH / 2);
  const shownId = card ?? lastCard;
  useLayoutEffect(() => {
    const row = shownId ? list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(shownId)}"]`) : null;
    if (!row || !list.current) return;
    setAnchor(top.get() + list.current.offsetTop + row.offsetTop - list.current.scrollTop + row.offsetHeight / 2);
  }, [shownId, contentH, ids, bodyH, top]);
  const cardY = Math.round(Math.min(stageH - cardH - CARD_MARGIN, Math.max(CARD_MARGIN, anchor - cardH / 2)));
  const cardShown = card !== null;
  // gliding is for moving between bots; a card coming out appears where the bot is
  const wasShown = useRef(false);
  const glide = wasShown.current && !reduced ? SETTLE : { duration: 0 };
  useEffect(() => { wasShown.current = cardShown; });

  const live = useRef({ slidOut, cardShown, cardY, cardH });
  live.current = { slidOut, cardShown, cardY, cardH };
  const overCard = useCallback((x: number, y: number) => {
    const { cardShown: showing, cardY: cy, cardH: ch } = live.current;
    // the gap between the card and the column counts, so crossing it never closes the card
    return showing && x >= cardLeft - GRACE && x <= columnLeft + 2 && y >= cy - GRACE && y <= cy + ch + GRACE;
  }, [cardLeft, columnLeft]);
  // where clicks land: the column where it is headed (a quick move onto a mascot while it still slides in must not
  // count as leaving), or the card
  const anyBots = useRef(false);
  anyBots.current = bots.length > 0;
  const hit = useCallback((x: number, y: number) => {
    if (!anyBots.current) return false;
    if (overCard(x, y)) return true;
    const t = top.get();
    if (!live.current.slidOut) return y >= t - d.ear && y <= t + h.get() + d.ear && x >= edge - EDGE;
    return y >= t - d.ear - GRACE && y <= t + h.get() + d.ear + GRACE && x >= columnLeft - GRACE;
  }, [overCard, top, h, d.ear, edge, columnLeft]);

  // a visit: from the column coming out to it going away. Its first card waits for intent; after that, moving from bot
  // to bot moves the card at once.
  const chosen = useRef(false);
  const landing = useRef<{ x: number; y: number; id: string } | null>(null);
  const under = useRef<string | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cardLeave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;
  const show = useCallback((id: string) => {
    clearTimeout(dwell.current);
    clearTimeout(cardLeave.current);
    chosen.current = true;
    setCard(id);
  }, []);
  const letGo = useCallback(() => {
    clearTimeout(dwell.current);
    clearTimeout(cardLeave.current);
    cardLeave.current = setTimeout(() => { if (!pinnedNow.current) setCard(null); }, CARD_LEAVE_MS);
  }, []);
  // judged on real pointer moves only, so arriving from far away is never mistaken for a move on the column
  const consider = useCallback((x: number, y: number) => {
    if (overCard(x, y)) { clearTimeout(cardLeave.current); return; }
    const id = under.current;
    if (!id) { if (live.current.cardShown) letGo(); else clearTimeout(dwell.current); return; }
    clearTimeout(cardLeave.current);
    if (chosen.current || live.current.cardShown) { show(id); return; }
    const land = landing.current;
    if (land && land.id !== id) { show(id); return; }
    if (!land) {
      landing.current = { x, y, id };
      clearTimeout(dwell.current);
      dwell.current = setTimeout(() => { if (under.current) show(under.current); }, DWELL_MS);
      return;
    }
    if (Math.hypot(x - land.x, y - land.y) > NUDGE_PX) show(id);
  }, [overCard, letGo, show]);
  const inside = usePointerRegion(bridge, hit, () => { clearTimeout(hideTimer.current); setOut(true); }, () => {
    clearTimeout(hideTimer.current);
    under.current = null;
    letGo();
    hideTimer.current = setTimeout(() => {
      if (dragging.current) return;
      setOut(false);
      chosen.current = false;
      landing.current = null;
    }, HIDE_MS);
  });
  const lastPoint = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const move = (event: MouseEvent) => {
      lastPoint.current = { x: event.clientX, y: event.clientY };
      if (inside.current) consider(event.clientX, event.clientY);
    };
    document.addEventListener("mousemove", move, { passive: true });
    return () => document.removeEventListener("mousemove", move);
  }, [inside, consider]);
  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(dwell.current); clearTimeout(cardLeave.current); }, []);
  // the pointer reached a mascot (or left them all): once a card is out it follows at once; the first waits for a move
  const pointAt = (id: string | null) => {
    under.current = id;
    if (id && (chosen.current || live.current.cardShown)) show(id);
    else if (!id && live.current.cardShown && !overCard(lastPoint.current.x, lastPoint.current.y)) letGo();
  };
  // a click anywhere else (the window loses focus) puts the dock away, fields and all
  useEffect(() => {
    const blur = () => {
      setPinned(false);
      bridge.typing?.(false);
      if (!inside.current) { setCard(null); setOut(false); chosen.current = false; landing.current = null; }
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [inside, bridge]);

  // a card that stayed on a reply or a failure for a real look counts as seeing it
  const since = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    const was = since.current;
    since.current = card ? { id: card, at: Date.now() } : null;
    if (!was || was.id === card || Date.now() - was.at < LOOK_MS) return;
    const bot = byId.get(was.id);
    if (bot && isFresh(bot, seen)) mark([eventKey(bot)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const now = useNow(slidOut);
  const { sent, cheering, markSent } = useRowMoments(bots);
  const save = (next: string[]) => bridge.order(next);
  const nudge = (id: string, step: -1 | 1) => {
    const index = ids.indexOf(id), to = index + step;
    if (index < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[index], next[to]] = [next[to]!, next[index]!];
    setIds(next);
    save(next);
  };
  const act = (bot: AmbientBot, next: AmbientAct) => {
    if (next.kind === "answer" || next.kind === "allow" || next.kind === "deny") markSent(bot);
    bridge.act(next);
  };
  const open = (bot: AmbientBot) => {
    if (moved.current) { moved.current = false; return; }
    if (isFresh(bot, seen)) mark([eventKey(bot)]);
    bridge.open(bot.id, bot.threadId);
  };
  const pin = useCallback((on: boolean) => { setPinned(on); bridge.typing?.(on); }, [bridge]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    pin(false); setCard(null); setOut(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const listMax = Math.max(d.cell, maxBody - 2 * d.pad - d.cell);
  const cardBot = shownId ? byId.get(shownId) ?? null : null;

  return (
    // no bots, no dock: never an empty column or a lone "+" (kept laid out but unseen, so it measures itself when they come)
    <div className="amb-stage" data-empty={bots.length ? undefined : ""} style={{ width: stageW, height: stageH }} onKeyDown={onKeyDown}>
      <motion.div
        className="amb-dock"
        role="region"
        aria-label={say(labels, "dock")}
        data-hidden={slidOut ? undefined : ""}
        style={{ x: slide, width: stageW, height: stageH, ["--amb-over" as string]: `${over}px` }}
      >
        <motion.span aria-hidden className="amb-ear amb-ear-top" style={{ y: earTop, width: d.ear, height: d.ear }} />
        <motion.span aria-hidden className="amb-ear amb-ear-bottom" style={{ y: earBottom, width: d.ear, height: d.ear }} />
        <motion.div className="amb-dock-body" style={{ clipPath: clip }}>
          <motion.div ref={content} className="amb-dock-column" style={{ y: top, left: columnLeft, width: d.column + over, paddingBlock: d.pad }}>
            <Reorder.Group ref={list} as="ul" axis="y" values={ids} onReorder={setIds} className="amb-dock-list" style={{ maxHeight: listMax }} onPointerLeave={() => pointAt(null)}>
              {shown.map((bot, index) => (
                <DockMascot
                  key={bot.id}
                  index={index}
                  cheer={cheer}
                  bot={bot}
                  labels={labels}
                  tile={d.tile}
                  cell={d.cell}
                  live={slidOut}
                  reduced={reduced}
                  showing={card === bot.id}
                  news={newsOf(bot, seen)}
                  state={cheering.has(bot.id) ? "celebrate" : sent.has(bot.id) ? "approving" : isSeenEvent(bot, seen) ? "idle" : undefined}
                  onOpen={() => open(bot)}
                  onPoint={() => pointAt(bot.id)}
                  onFocus={() => show(bot.id)}
                  onDragStart={() => { dragging.current = true; moved.current = true; setCard(null); }}
                  onDragEnd={() => { dragging.current = false; save(idsNow.current); }}
                  onPress={() => { moved.current = false; }}
                  onMove={(step) => nudge(bot.id, step)}
                />
              ))}
            </Reorder.Group>
            <div className="amb-dock-foot" style={{ height: d.cell, width: d.column }}>
              <button type="button" className="amb-dock-plus" aria-label={say(labels, "newBot")} title={say(labels, "newBot")} onClick={() => bridge.act({ kind: "new-bot" })}>
                <Plus size={18} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
      <motion.div
        className="amb-card"
        role="dialog"
        aria-label={cardBot?.name}
        data-card={card ?? undefined}
        inert={!cardShown}
        style={{ left: cardLeft, top: 0, width: CARD_W, transformOrigin: "100% 50%" }}
        initial={false}
        animate={cardShown
          ? { opacity: 1, scale: 1, x: 0, y: cardY, height: cardH }
          : { opacity: 0, scale: reduced ? 1 : 0.97, x: reduced ? 0 : 6, y: cardY, height: cardH }}
        transition={cardShown
          ? { opacity: FADE, scale: glide === SETTLE ? SETTLE : LIVELY, x: SETTLE, y: glide, height: glide }
          : { opacity: CARD_OUT, scale: CARD_OUT, x: CARD_OUT, y: { duration: 0 }, height: { duration: 0 } }}
      >
        <div ref={cardInner} className="amb-card-inner">
          <AnimatePresence initial={false} mode="popLayout">
            {cardBot && (
              <motion.div
                key={cardBot.id}
                className="amb-card-page"
                initial={reduced ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)", transition: SWAP_IN }}
                exit={reduced ? { opacity: 0, transition: SWAP_OUT } : { opacity: 0, filter: "blur(4px)", transition: SWAP_OUT }}
              >
                <MiniChat
                  bot={cardBot}
                  labels={labels}
                  lang={lang}
                  now={now}
                  sent={sent.has(cardBot.id)}
                  fresh={isFresh(cardBot, seen) && !cardBot.quiet}
                  onOpen={() => open(cardBot)}
                  onAct={(next) => act(cardBot, next)}
                  onPin={pin}
                  onDismiss={() => mark([eventKey(cardBot)])}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

type News = "ask" | "reply" | "error" | null;

/** What a mascot's bubble says: an ask, an unseen reply, an unseen failure, or nothing at all. */
export function newsOf(bot: AmbientBot, seen: ReadonlySet<string>): News {
  if (bot.quiet) return null;
  if (bot.status === "needs-you") return "ask";
  if (!isFresh(bot, seen)) return null;
  return bot.status === "error" ? "error" : "reply";
}

function DockMascot({ index, cheer, bot, labels, tile, cell, live, reduced, showing, news, state, onOpen, onPoint, onFocus, onDragStart, onDragEnd, onPress, onMove }: {
  index: number; cheer: number; bot: AmbientBot; labels: AmbientLabels; tile: number; cell: number; live: boolean; reduced: boolean; showing: boolean;
  news: News; state: "celebrate" | "approving" | "idle" | undefined; onOpen: () => void; onPoint: () => void; onFocus: () => void;
  onDragStart: () => void; onDragEnd: () => void; onPress: () => void; onMove: (step: -1 | 1) => void;
}) {
  const controls = useDragControls();
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  };
  const onPointerDown = (event: ReactPointerEvent) => { onPress(); controls.start(event); };
  // hidden, the sliver still ticks who waits, failed, works or replied; what the person is watching ticks nothing
  const tick = bot.quiet ? null : news ?? (isBusy(bot.status) ? "busy" : null);
  return (
    <Reorder.Item
      as="li"
      value={bot.id}
      className="amb-dock-cell"
      data-row={bot.id}
      style={{ height: cell }}
      onPointerEnter={onPoint}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={reduced ? undefined : { scale: 1.06 }}
      transition={SETTLE}
    >
      <button
        type="button"
        className="amb-dock-bot"
        data-showing={showing || undefined}
        aria-label={`${say(labels, "open", { name: bot.name })}. ${bot.status === "idle" ? "" : `${say(labels, bot.status)}. `}${say(labels, "reorder")}`}
        aria-expanded={showing}
        onPointerDown={onPointerDown}
        onClick={onOpen}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        <span className="amb-lift">
          <motion.span className="amb-dock-mark" whileTap={reduced ? undefined : { scale: 0.96 }}>
            <BotMark bot={bot} size={tile} state={state} animated={live} awake={live} index={index} cheer={cheer} />
          </motion.span>
        </span>
        <AnimatePresence initial={false}>
          {news && (
            <motion.span
              key={news}
              className="amb-bubble"
              data-kind={news}
              aria-hidden
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1, transition: { opacity: FADE, scale: LIVELY } }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.6, transition: FADE_OUT }}
            >
              {news === "ask" ? Math.max(1, bot.asks) : news === "error" ? "!" : null}
            </motion.span>
          )}
        </AnimatePresence>
        {/* a working bot says so on its mascot too, not only by its pose */}
        {isBusy(bot.status) && !bot.quiet && <span className="amb-pip" aria-hidden />}
        {tick && <span className="amb-tick" data-kind={tick} aria-hidden />}
      </button>
    </Reorder.Item>
  );
}
