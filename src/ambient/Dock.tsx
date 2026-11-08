// The bot dock: a black panel against the right edge of the screen that flares into it at both ends, one mascot per
// bot and a ＋ under them. At rest only a sliver shows; the pointer at the edge slides it in. A bot under the pointer
// grows a little and its card slides out to the left; dragging a bot moves it.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, Reorder, motion, useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import { dockOrder, isBusy, shortAgo } from "./mood";
import { say, type AmbientLabels } from "./labels";
import { BotMark, FADE, FADE_OUT, LIVELY, SETTLE, StatusTag, useAmbientFeed, useNow, usePointerRegion } from "./shared";
import type { AmbientBot, AmbientBridge } from "./types";

/** How near the right edge the pointer has to be, inside the dock's height, to bring it in. */
const EDGE = 14;
const HIDE_MS = 420;
/** A bot that starts needing the person brings the dock out this long. */
const PEEK_MS = 3600;
const CARD_W = 236;
const CARD_H = 88;
const FALLBACK_DOCK = { cell: 52, tile: 34, body: 64, pad: 10, ear: 18, sliver: 6, cardRoom: 300, spill: 64, max: 12 };

export function Dock({ bridge }: { bridge: AmbientBridge }) {
  const { snapshot, layout } = useAmbientFeed(bridge);
  const dock = layout?.surface === "dock" ? layout : null;
  const reduced = useReducedMotion() === true;
  const labels = snapshot?.labels ?? {};
  const bots = snapshot?.bots ?? [];
  const lang = snapshot?.lang ?? "";
  const d = dock?.dock ?? FALLBACK_DOCK;
  const stageW = dock?.width ?? d.body + d.cardRoom;
  const stageH = dock?.height ?? 400;
  const top = dock?.top ?? d.ear + d.spill;
  const body = dock?.body ?? stageH - 2 * top;
  const visible = Math.max(0, Math.floor((body - 2 * d.pad) / d.cell) - 1);

  const [ids, setIds] = useState<string[]>([]);
  const idsNow = useRef(ids);
  idsNow.current = ids;
  const dragging = useRef(false);
  const moved = useRef(false);
  useEffect(() => {
    if (dragging.current) return;
    setIds(dockOrder(bots, dock?.order ?? []).map((bot) => bot.id));
  }, [bots, dock?.order]);
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const shown = ids.map((id) => byId.get(id)).filter((bot): bot is AmbientBot => Boolean(bot)).slice(0, visible);

  const [out, setOut] = useState(false);
  const [peek, setPeek] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const slidOut = out || peek;

  // someone starts needing the person: the dock comes out for a moment on its own
  const waiting = bots.filter((bot) => bot.status === "needs-you").map((bot) => bot.id).join(",");
  const lastWaiting = useRef<string | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!snapshot) return;
    const first = lastWaiting.current === null;
    const before = new Set((lastWaiting.current ?? "").split(",").filter(Boolean));
    lastWaiting.current = waiting;
    // the first summary is how things stand, not news
    if (first || !waiting.split(",").some((id) => id && !before.has(id))) return;
    setPeek(true);
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(false), PEEK_MS);
  }, [waiting, snapshot]);
  useEffect(() => () => clearTimeout(peekTimer.current), []);

  const bodyX = stageW - d.body;
  const cellTop = (index: number) => top + d.pad + index * d.cell;
  const hoverIndex = hover ? shown.findIndex((bot) => bot.id === hover) : -1;
  const cardTop = hoverIndex < 0 ? 0 : Math.min(stageH - CARD_H - 4, Math.max(4, cellTop(hoverIndex) + d.cell / 2 - CARD_H / 2));

  const hit = useCallback((x: number, y: number) => {
    if (y < top - d.ear || y > top + body + d.ear) return false;
    if (!slidOut) return x >= stageW - EDGE;
    if (x >= bodyX - 2) return true;
    return hoverIndex >= 0 && x >= bodyX - CARD_W - 12 && y >= cardTop && y <= cardTop + CARD_H;
  }, [top, body, d.ear, slidOut, stageW, bodyX, hoverIndex, cardTop]);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  usePointerRegion(bridge, hit, () => { clearTimeout(hideTimer.current); setOut(true); }, () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!dragging.current) { setOut(false); setHover(null); } }, HIDE_MS);
  });
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const offset = slidOut ? 0 : d.body - d.sliver;
  const now = useNow(slidOut);
  const save = (next: string[]) => bridge.order(next);
  const nudge = (id: string, step: -1 | 1) => {
    const index = ids.indexOf(id), to = index + step;
    if (index < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[index], next[to]] = [next[to]!, next[index]!];
    setIds(next);
    save(next);
  };
  const hovered = hoverIndex >= 0 ? shown[hoverIndex]! : null;

  return (
    <div className="amb-stage" style={{ width: stageW, height: stageH }}>
      <motion.div
        className="amb-dock"
        aria-label={say(labels, "dock")}
        role="region"
        style={{ left: bodyX, top: top - d.ear, width: d.body, height: body + 2 * d.ear }}
        initial={false}
        animate={reduced ? { x: 0, opacity: slidOut ? 1 : 0.001 } : { x: offset, opacity: 1 }}
        transition={reduced ? { opacity: FADE } : { x: SETTLE }}
      >
        <span aria-hidden className="amb-ear amb-ear-top" style={{ width: d.ear, height: d.ear, right: 0, top: 0 }} />
        <span aria-hidden className="amb-ear amb-ear-bottom" style={{ width: d.ear, height: d.ear, right: 0, bottom: 0 }} />
        <div className="amb-dock-body" style={{ top: d.ear, height: body, paddingBlock: d.pad }}>
          <Reorder.Group as="ul" axis="y" values={ids} onReorder={setIds} className="amb-dock-list">
            {shown.map((bot) => (
              <Reorder.Item
                as="li"
                key={bot.id}
                value={bot.id}
                className="amb-dock-cell"
                style={{ height: d.cell }}
                onDragStart={() => { dragging.current = true; moved.current = true; setHover(null); }}
                onDragEnd={() => { dragging.current = false; save(idsNow.current); }}
                whileDrag={reduced ? undefined : { scale: 1.08 }}
              >
                <DockBot
                  bot={bot}
                  size={d.tile}
                  labels={labels}
                  hovered={hover === bot.id}
                  live={slidOut}
                  reduced={reduced}
                  onHover={(on) => setHover((was) => (on ? bot.id : was === bot.id ? null : was))}
                  onOpen={() => { if (moved.current) { moved.current = false; return; } bridge.open(bot.id, bot.threadId); }}
                  onPointerDown={() => { moved.current = false; }}
                  onMove={(step) => nudge(bot.id, step)}
                />
              </Reorder.Item>
            ))}
          </Reorder.Group>
          <button type="button" className="amb-dock-plus" style={{ height: d.cell }} aria-label={say(labels, "newBot")} title={say(labels, "newBot")} onClick={() => bridge.act({ kind: "new-bot" })}>
            <Plus size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        {/* hidden, the sliver still says who is waiting */}
        {shown.map((bot, index) => bot.status === "needs-you" ? (
          <motion.span key={bot.id} aria-hidden className="amb-sliver-tick" style={{ top: d.ear + d.pad + index * d.cell + d.cell / 2 - 6 }} initial={false} animate={{ opacity: slidOut ? 0 : 1 }} transition={FADE} />
        ) : null)}
      </motion.div>
      <AnimatePresence>
        {slidOut && hovered && !dragging.current && (
          <motion.div
            key="card"
            className="amb-card"
            role="tooltip"
            style={{ right: d.body + 10, width: CARD_W, minHeight: CARD_H, top: 0, transformOrigin: "100% 50%" }}
            initial={reduced ? { opacity: 0, y: cardTop } : { opacity: 0, x: 8, y: cardTop, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, y: cardTop, scale: 1 }}
            exit={reduced ? { opacity: 0, transition: FADE_OUT } : { opacity: 0, x: 6, scale: 0.98, transition: FADE_OUT }}
            transition={{ opacity: FADE, x: SETTLE, y: SETTLE, scale: SETTLE }}
          >
            <Card bot={hovered} labels={labels} lang={lang} now={now} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DockBot({ bot, size, labels, hovered, live, reduced, onHover, onOpen, onPointerDown, onMove }: {
  bot: AmbientBot; size: number; labels: AmbientLabels; hovered: boolean; live: boolean; reduced: boolean;
  onHover: (on: boolean) => void; onOpen: () => void; onPointerDown: () => void; onMove: (step: -1 | 1) => void;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <button
      type="button"
      className="amb-dock-bot"
      aria-label={`${say(labels, "open", { name: bot.name })}. ${say(labels, bot.status)}. ${say(labels, "reorder")}`}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onPointerDown={onPointerDown}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <motion.span className="amb-dock-mark" initial={false} animate={{ scale: hovered && !reduced ? 1.12 : 1 }} transition={LIVELY} whileTap={reduced ? undefined : { scale: 0.96 }}>
        <BotMark bot={bot} size={size} animated={live && (isBusy(bot.status) || bot.status === "needs-you" || hovered)} />
      </motion.span>
      <Badge bot={bot} />
    </button>
  );
}

function Badge({ bot }: { bot: AmbientBot }) {
  if (bot.status === "needs-you") return <span className="amb-badge" data-kind="needs-you">{Math.max(1, bot.asks)}</span>;
  if (bot.status === "error") return <span className="amb-badge" data-kind="error">!</span>;
  if (bot.unread) return <span className="amb-badge" data-kind="unread" />;
  return null;
}

function Card({ bot, labels, lang, now }: { bot: AmbientBot; labels: AmbientLabels; lang: string; now: number }) {
  const busy = isBusy(bot.status);
  const detail = bot.detail && bot.detail !== say(labels, bot.status) ? bot.detail : "";
  const line = (busy || bot.status === "needs-you") && detail ? detail : bot.line;
  return (
    <div className="amb-card-body">
      <div className="amb-card-top">
        <span className="amb-card-name">{bot.name}</span>
        <span className="amb-row-time">{shortAgo(bot.at, now, lang, say(labels, "now"))}</span>
      </div>
      <StatusTag status={bot.status} labels={labels} />
      {line && <p className="amb-card-line" dir="auto">{line}</p>}
    </div>
  );
}
