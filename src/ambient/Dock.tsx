// The bot dock: one black body against the right edge of the screen that flares into it at both ends. At rest only a
// sliver shows, ticked where a bot works, replied or waits. The pointer at the edge slides in a column of mascots; moving
// onto them widens the same body to the left, and each bot's words come out of it beside its mascot, with any ask it
// waits on answered right there. The mascots never move while it opens. Dragging a mascot reorders the dock.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Reorder, motion, useDragControls, useReducedMotion, useTransform } from "motion/react";
import { Plus } from "lucide-react";
import { dockOrder, isBusy } from "./mood";
import { BotRow, useHoverBand, useRowMoments } from "./rows";
import { attention, eventKey, isFresh, isSeenEvent, useSeen } from "./seen";
import { say, type AmbientLabels } from "./say";
import { BotMark, SETTLE, useAllClear, useAmbientFeed, useSurfaceValue, useNow, usePointerRegion } from "./shared";
import type { AmbientAct, AmbientBot, AmbientBridge, DockLayout } from "./types";

/** How near the right edge the pointer has to be, beside the body, to bring the dock in. */
const EDGE = 14;
/** Past this far from the edge the pointer is on the mascots, and the dock opens. */
const WIDE_AT = 18;
const HIDE_MS = 140;
/** Arriving at the edge only brings the column in; opening takes a move toward the bots, or resting on them this long. */
const DWELL_MS = 450;
/** How far toward the bots counts as a move. */
const NUDGE_PX = 6;
/** A bot that starts needing the person, or fails, brings the dock out this long. */
const PEEK_MS = 3600;
const RADIUS = 22;
// one empty list for "nothing yet": a fresh [] each render would rerun the order effect forever
const NONE: readonly never[] = [];
const FALLBACK_DOCK: DockLayout["dock"] = { cell: 56, tile: 36, column: 64, open: 348, pad: 8, ear: 18, sliver: 6, margin: 28, overhang: 4 };

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
  const [wide, setWide] = useState(false);
  const [peek, setPeek] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [focused, setFocused] = useState(false);
  const opened = wide || pinned || focused;
  const slidOut = out || peek || opened;

  // someone starts needing the person, or fails: the dock comes out for a moment on its own
  // a reply or failure is news until seen; after that the dock only keeps its line, muted
  const { seen, mark } = useSeen(bridge, bots, opened);
  // everything answered or seen: the whole column cheers once
  const { cheer } = useAllClear(attention(bots, seen).some((bot) => bot.status !== "idle"), 2400);
  const calling = bots.filter((bot) => !bot.quiet).filter((bot) => bot.status === "needs-you" || (bot.status === "error" && isFresh(bot, seen))).map((bot) => bot.id).join(",");
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

  // the body is as tall as what it shows, centred on the edge; it widens to the left and slides in from the right
  const content = useRef<HTMLDivElement>(null);
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
  const w = useSurfaceValue(opened ? d.open : d.column, reduced);
  const h = useSurfaceValue(bodyH, reduced);
  const slide = useSurfaceValue(slidOut ? 0 : d.column - d.sliver, reduced, slidOut);
  const top = useTransform(h, (value) => Math.round((stageH - value) / 2));
  const clip = useTransform(() => {
    const t = top.get();
    return `inset(${t}px 0px ${Math.max(0, stageH - t - h.get())}px ${Math.max(0, edge - w.get())}px round ${RADIUS}px 0px 0px ${RADIUS}px)`;
  });
  const earTop = useTransform(top, (value) => value - d.ear);
  const earBottom = useTransform(() => top.get() + h.get());

  const slidOutNow = useRef(slidOut);
  slidOutNow.current = slidOut;
  // where the body is right now, mid-spring included: only there do clicks land
  const hit = useCallback((x: number, y: number) => {
    const t = top.get();
    if (y < t - d.ear || y > t + h.get() + d.ear) return false;
    if (!slidOutNow.current) return x >= edge - EDGE;
    return x >= edge - w.get() + slide.get() - 2;
  }, [top, h, w, slide, d.ear, edge]);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const entered = useRef<number | null>(null);
  const inside = usePointerRegion(bridge, hit, () => { clearTimeout(hideTimer.current); entered.current = null; setOut(true); }, () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!dragging.current) { setOut(false); setWide(false); } }, HIDE_MS);
  });
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  // on the bots, past the edge zone: a move toward them opens it at once, resting there opens it after a moment, and a
  // brush on the way somewhere else only brought the column in
  useEffect(() => {
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const move = (event: MouseEvent) => {
      if (!inside.current) { clearTimeout(dwell); dwell = undefined; return; }
      const x = event.clientX;
      entered.current ??= x;
      const onBots = x < edge - WIDE_AT;
      if (!onBots) { clearTimeout(dwell); dwell = undefined; return; }
      if (entered.current - x >= NUDGE_PX) { clearTimeout(dwell); setWide(true); return; }
      dwell ??= setTimeout(() => { if (inside.current) setWide(true); }, DWELL_MS);
    };
    document.addEventListener("mousemove", move, { passive: true });
    return () => { clearTimeout(dwell); document.removeEventListener("mousemove", move); };
  }, [inside, edge]);
  // a click anywhere else (the window loses focus) puts the dock away, fields and all
  useEffect(() => {
    const blur = () => { setPinned(false); setFocused(false); if (!inside.current) { setOut(false); setWide(false); } };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [inside]);

  const now = useNow(slidOut);
  const { sent, cheering, markSent } = useRowMoments(bots);

  // one highlight for the whole hover session (rows.tsx): it glides from bot to bot and never remakes itself
  const list = useRef<HTMLUListElement>(null);
  const band = useHoverBand(list, opened && !dragging.current, `${contentH}:${ids.join(",")}`);
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
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    setPinned(false); setWide(false); setOut(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const listMax = Math.max(d.cell, maxBody - 2 * d.pad - d.cell);

  return (
    <div className="amb-stage" style={{ width: stageW, height: stageH }} onKeyDown={onKeyDown}>
      <motion.div
        className="amb-dock"
        role="region"
        aria-label={say(labels, "dock")}
        data-hidden={slidOut ? undefined : ""}
        data-open={opened || undefined}
        style={{ x: slide, width: stageW, height: stageH, ["--amb-over" as string]: `${over}px` }}
        onFocus={() => setFocused(true)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      >
        <motion.span aria-hidden className="amb-ear amb-ear-top" style={{ y: earTop, width: d.ear, height: d.ear }} />
        <motion.span aria-hidden className="amb-ear amb-ear-bottom" style={{ y: earBottom, width: d.ear, height: d.ear }} />
        <motion.div className="amb-dock-body" style={{ clipPath: clip }}>
          <motion.div ref={content} className="amb-dock-content" style={{ y: top, paddingBlock: d.pad, ["--amb-column" as string]: `${d.column}px`, ["--amb-cell" as string]: `${d.cell}px` }}>
            <Reorder.Group ref={list} as="ul" axis="y" values={ids} onReorder={setIds} className="amb-dock-list" style={{ maxHeight: listMax }} onPointerLeave={() => band.point(null)}>
              {band.element}
              {shown.map((bot, index) => (
                <DockItem
                  index={index}
                  cheer={cheer}
                  key={bot.id}
                  bot={bot}
                  labels={labels}
                  lang={lang}
                  now={now}
                  tile={d.tile}
                  opened={opened}
                  live={slidOut}
                  reduced={reduced}
                  sent={sent.has(bot.id)}
                  cheering={cheering.has(bot.id)}
                  recent={isSeenEvent(bot, seen)}
                  onDismiss={() => mark([eventKey(bot)])}
                  onOpen={() => { if (moved.current) { moved.current = false; return; } if (isFresh(bot, seen)) mark([eventKey(bot)]); bridge.open(bot.id, bot.threadId); }}
                  onAct={(next) => act(bot, next)}
                  onPin={setPinned}
                  onDragStart={() => { dragging.current = true; moved.current = true; }}
                  onDragEnd={() => { dragging.current = false; save(idsNow.current); }}
                  onPress={() => { moved.current = false; }}
                  onMove={(step) => nudge(bot.id, step)}
                  onPoint={() => band.point(bot.id)}
                />
              ))}
            </Reorder.Group>
            <div className="amb-dock-foot" style={{ height: d.cell }}>
              <Summary bots={bots.filter((bot) => !isSeenEvent(bot, seen))} labels={labels} />
              <button type="button" className="amb-dock-plus" aria-label={say(labels, "newBot")} title={say(labels, "newBot")} onClick={() => bridge.act({ kind: "new-bot" })}>
                <Plus size={18} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function DockItem({ index, cheer, bot, labels, lang, now, tile, opened, live, reduced, sent, cheering, recent, onDismiss, onOpen, onAct, onPin, onDragStart, onDragEnd, onPress, onMove, onPoint }: {
  index: number; cheer: number; bot: AmbientBot; labels: AmbientLabels; lang: string; now: number; tile: number; opened: boolean; live: boolean; reduced: boolean;
  sent: boolean; cheering: boolean; recent: boolean; onDismiss: () => void; onOpen: () => void; onAct: (act: AmbientAct) => void; onPin: (pinned: boolean) => void;
  onDragStart: () => void; onDragEnd: () => void; onPress: () => void; onMove: (step: -1 | 1) => void; onPoint: () => void;
}) {
  const controls = useDragControls();
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  };
  const onPointerDown = (event: ReactPointerEvent) => { onPress(); controls.start(event); };
  const state = cheering ? "celebrate" : sent ? "approving" : recent ? "idle" : undefined;
  // what the person is watching in the app ticks nothing here
  const tick = bot.quiet ? null : bot.status === "needs-you" ? "ask" : recent ? null : bot.status === "error" ? "error" : isBusy(bot.status) ? "busy" : bot.unread ? "reply" : null;
  const mascot = (
    <button
      type="button"
      className="amb-dock-bot"
      aria-label={`${say(labels, "open", { name: bot.name })}. ${bot.status === "idle" ? "" : `${say(labels, bot.status)}. `}${say(labels, "reorder")}`}
      onPointerDown={onPointerDown}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <motion.span className="amb-dock-mark" whileTap={reduced ? undefined : { scale: 0.96 }}>
        <BotMark bot={bot} size={tile} state={state} animated={live} awake={live} shown={live} index={index} cheer={cheer} />
      </motion.span>
      {tick && <span className="amb-tick" data-kind={tick} aria-hidden />}
    </button>
  );
  return (
    <Reorder.Item
      as="li"
      value={bot.id}
      className="amb-dock-cell"
      data-row={bot.id}
      onPointerEnter={onPoint}
      onPointerMove={onPoint}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={reduced ? undefined : { scale: 1.03 }}
      transition={SETTLE}
    >
      <BotRow bot={bot} labels={labels} lang={lang} now={now} side="dock" open={opened} sent={sent} mascot={mascot} recent={recent} onOpen={onOpen} onAct={onAct} onPin={onPin} onDismiss={onDismiss} />
    </Reorder.Item>
  );
}

/** Who needs the person, who works and who replied, in a line; nothing while all rest. */
function Summary({ bots, labels }: { bots: readonly AmbientBot[]; labels: AmbientLabels }) {
  const count = (test: (bot: AmbientBot) => boolean) => bots.filter(test).length;
  const parts = ([
    ["needs-you", count((bot) => bot.status === "needs-you")],
    ["working", count((bot) => isBusy(bot.status))],
    ["done", count((bot) => bot.status === "done")],
  ] as const).filter(([, n]) => n > 0);
  if (!bots.length) return <p className="amb-dock-sum">{say(labels, "empty")}</p>;
  return (
    <p className="amb-dock-sum" aria-live="polite">
      {parts.length ? parts.map(([key, n]) => (
        <span key={key} className="amb-sum-part" data-status={key}><span className="amb-num">{n}</span> {say(labels, key)}</span>
      )) : say(labels, "quiet")}
    </p>
  );
}
