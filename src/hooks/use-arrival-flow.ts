import { animate, spring } from "motion/react";
import { useLayoutEffect, useRef, type RefObject } from "react";

import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { EASE, MSG_FADE, SPRING_SETTLE } from "@/lib/motion-presets";

const ROW = "[data-message-row]";
const SLOT = ".turn-status-slot";
const ARRIVAL = "[data-arrival]";
const STATUS_LINE = ".turn-presence > div";
const BOT_BUBBLE = ".chat-bubble-bot";

/** How far below its place the person's own bubble starts, and how long it takes to glide up while it fades in (ms). */
export const SEND_RISE_PX = 24;
export const SEND_MS = 220;
/** One easing for every arrival: a decelerating curve with no overshoot whose start is gentle enough that a tall reply
 * opens rather than snaps. */
export const ARRIVAL_CURVE = EASE.drawer;
export const ARRIVAL_EASE = `cubic-bezier(${ARRIVAL_CURVE.join(", ")})`;
/** A reply's reveal takes longer the taller it is, within these bounds (ms), so a long answer opens rather than snaps. */
export const REVEAL_MS = [260, 520] as const;
const REVEAL_SHORT_PX = 36;
const REVEAL_TALL_PX = 360;
/** The status line fades out as a reply fades in, and if it still has work to report it comes back in its slot (ms). */
const LINE_OUT_MS = 160;
const LINE_BACK_AT_MS = 300;
const LINE_BACK_MS = 160;

type Timing = { duration: number; easing: string };
const timings = new Map<object, Timing>();

/** A spring as a Web Animations timing, sampled every 8ms into `linear()`: the compositor runs it, it applies in the
 * frame it starts, and every mover shares one curve and clock. */
export function springTiming(preset: { stiffness: number; damping: number; mass: number }): Timing {
  const known = timings.get(preset);
  if (known) return known;
  const { stiffness, damping, mass } = preset;
  const gen = spring({ keyframes: [0, 1], stiffness, damping, mass, restDelta: 0.0005, restSpeed: 0.005 });
  const points: number[] = [];
  let t = 0;
  for (; t <= 2000; t += 8) {
    const step = gen.next(t);
    points.push(Math.round(step.value * 10000) / 10000);
    if (step.done) break;
  }
  points[points.length - 1] = 1;
  const timing = { duration: t, easing: `linear(${points.join(", ")})` };
  timings.set(preset, timing);
  return timing;
}

/** How long a reply `height` px tall takes to open, on the arrival ease. */
export function revealTiming(height: number): Timing {
  const share = Math.min(1, Math.max(0, (height - REVEAL_SHORT_PX) / (REVEAL_TALL_PX - REVEAL_SHORT_PX)));
  return { duration: Math.round(REVEAL_MS[0] + share * (REVEAL_MS[1] - REVEAL_MS[0])), easing: ARRIVAL_EASE };
}

const sendTiming = (): Timing => ({ duration: SEND_MS, easing: ARRIVAL_EASE });

interface Snapshot {
  key: string;
  anchor: HTMLElement | null;
  /** distance from the anchor's top to the end of the scrolled content */
  anchorFromEnd: number;
  slot: HTMLElement | null;
  slotFromEnd: number;
  /** the furthest the transcript could scroll then, and where it was */
  max: number;
  scrollTop: number;
  /** the working line as it was drawn, in the column's own coordinates */
  line: Box | null;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Mover {
  anim: Animation;
  from: number;
}

/** Top (or left) of `el` inside `column`, from layout alone (offsets ignore transforms, so moves in flight never count). */
function offsetIn(el: HTMLElement, column: HTMLElement, axis: "offsetTop" | "offsetLeft" = "offsetTop"): number | null {
  let at = 0;
  let node: HTMLElement | null = el;
  while (node && node !== column) {
    at += node[axis];
    node = node.offsetParent as HTMLElement | null;
  }
  return node === column ? at : null;
}

function boxIn(el: HTMLElement, column: HTMLElement): Box | null {
  const y = offsetIn(el, column), x = offsetIn(el, column, "offsetLeft");
  return x === null || y === null ? null : { x, y, width: el.offsetWidth, height: el.offsetHeight };
}

function lineBox(column: HTMLElement): Box | null {
  const line = column.querySelector<HTMLElement>(STATUS_LINE);
  return line ? boxIn(line, column) : null;
}

/** The reply's bubble grows out of the working line it replaces: it starts clipped to the line's box where the line was
 * drawn and opens to its own size, for longer the taller it is, while its words fade in a beat behind the shape, so they
 * never show squeezed into a box still opening. The line is already gone in this frame. Returns the timing it used. */
function growFromLine(bubble: HTMLElement, from: Box, column: HTMLElement): Timing | null {
  const to = boxIn(bubble, column);
  if (!to || !canAnimate(bubble)) return null;
  const rtl = getComputedStyle(bubble).direction === "rtl";
  const dx = rtl ? from.x + from.width - (to.x + to.width) : from.x - to.x;
  const end = Math.max(0, to.width - from.width), bottom = Math.max(0, to.height - from.height);
  const radius = Math.min(from.height, to.height) / 2;
  const timing = revealTiming(to.height);
  bubble.animate([
    { transform: `translate(${dx}px, ${from.y - to.y}px)`, clipPath: `inset(0px ${rtl ? 0 : end}px ${bottom}px ${rtl ? end : 0}px round ${radius}px)` },
    { transform: "translate(0px, 0px)", clipPath: `inset(0px 0px 0px 0px round ${radius}px)` },
  ], timing);
  const words = { delay: Math.round(timing.duration * 0.3), duration: Math.round(timing.duration * 0.6), easing: ARRIVAL_EASE, fill: "backwards" as const };
  for (const child of Array.from(bubble.children)) {
    if (canAnimate(child)) (child as HTMLElement).animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0px)" }], words);
  }
  return timing;
}

const canAnimate = (el: Element) => typeof (el as HTMLElement).animate === "function";

/** Where an in-flight mover is now, read from its own timing rather than the computed style. */
function remaining(mover: Mover): number {
  if (mover.anim.playState === "finished" || mover.anim.playState === "idle") return 0;
  const progress = mover.anim.effect?.getComputedTiming().progress;
  return mover.from * (1 - (typeof progress === "number" ? progress : 1));
}

/** One element's entrance on motion: the first frame is written to its style before the browser paints (motion starts on
 * its next frame), and the style is handed back when it settles, so no transform outlives the move. */
function lift(el: HTMLElement, transform: [string, string], opacity: [number, number] | null, timing: Timing, done: () => void): void {
  el.style.transform = transform[0];
  if (opacity) el.style.opacity = String(opacity[0]);
  const finish = () => {
    el.style.transform = "";
    if (opacity) el.style.opacity = "";
    done();
  };
  const keyframes = opacity ? { transform, opacity } : { transform };
  const transition = { duration: timing.duration / 1000, ease: ARRIVAL_CURVE };
  const options = opacity ? { transform: transition, opacity: { duration: Math.min(timing.duration / 1000, MSG_FADE.duration), ease: ARRIVAL_CURVE } } : { transform: transition };
  animate(el, keyframes, options).finished.then(finish, finish);
}

/** Rows that arrive while the conversation is open, and the scroll never fighting them.
 *
 * Any arrival puts the scroll at its end in the frame it lands, and the column glides from where it was on screen, so
 * nothing jumps. The person's own bubble rises a short way into place as it fades in (SEND_MS, one ease-out). A bot's reply
 * settles in softly where it lands while its status line fades out, coming back below if it still has work; a reply that
 * takes the place of the working line grows out of the line's box instead, for longer the taller it is (REVEAL_MS), its words
 * fading in a beat behind the shape, with the view gliding on the same curve. A wrapper clips the column vertically while
 * anything moves, so a transform never stretches the scroll range. The composer settling under a bubble still rising is
 * followed on a spring. Scrolled up, nothing on screen moves. Under reduced motion new rows only fade in. */
export function useArrivalFlow({
  scrollRef,
  clipRef,
  columnRef,
  transcriptKey,
  following,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  clipRef: RefObject<HTMLElement | null>;
  columnRef: RefObject<HTMLElement | null>;
  transcriptKey: string;
  following: boolean;
}): void {
  const reduced = usePrefersReducedMotion();
  const snapshot = useRef<Snapshot | null>(null);
  const movers = useRef(new Map<HTMLElement, Mover>());
  /** the person's bubbles (and the slot under them) still rising */
  const risers = useRef(new Set<HTMLElement>());
  const played = useRef(new WeakSet<Element>());

  const take = (key: string): void => {
    const scroller = scrollRef.current, column = columnRef.current;
    if (!scroller || !column) return;
    const anchor = (column.querySelectorAll<HTMLElement>(ROW).item(column.querySelectorAll(ROW).length - 1) as HTMLElement | null) ?? null;
    const slot = column.querySelector<HTMLElement>(SLOT);
    const end = scroller.scrollHeight;
    const anchorAt = anchor ? offsetIn(anchor, column) : null;
    const slotAt = slot ? offsetIn(slot, column) : null;
    snapshot.current = {
      key, anchor: anchorAt === null ? null : anchor, anchorFromEnd: end - (anchorAt ?? 0), slot: slotAt === null ? null : slot, slotFromEnd: end - (slotAt ?? 0),
      max: end - scroller.clientHeight, scrollTop: scroller.scrollTop, line: lineBox(column),
    };
  };

  // a size change outside a render (an image loading, the window resizing) moves the end without an arrival: re-measure
  useLayoutEffect(() => {
    const scroller = scrollRef.current, column = columnRef.current;
    if (!scroller || !column || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => take(transcriptKey));
    observer.observe(column);
    observer.observe(scroller);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- take reads refs only
  }, [scrollRef, columnRef, transcriptKey]);

  // a conversation left (or the transcript gone) drops whatever was still moving
  useLayoutEffect(() => {
    const all = movers.current;
    const clip = clipRef.current;
    return () => {
      for (const mover of all.values()) mover.anim.cancel();
      all.clear();
      risers.current.clear();
      if (clip) clip.style.overflowY = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref object is stable; only the conversation matters
  }, [transcriptKey]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current, column = columnRef.current, clip = clipRef.current;
    if (!scroller || !column) return;
    const before = snapshot.current;
    const arrivals = [...column.querySelectorAll<HTMLElement>(ARRIVAL)].filter((row) => !played.current.has(row));
    arrivals.forEach((row) => played.current.add(row));
    if (!before || before.key !== transcriptKey) {
      take(transcriptKey);
      return;
    }

    const end = scroller.scrollHeight;
    const max = end - scroller.clientHeight;
    // a transcript resting at its end stays there; mid-scroll (a jump to the latest in progress) is left alone
    const atEnd = scroller.scrollTop >= Math.min(before.max, max) - 2;
    const anchorAt = before.anchor?.isConnected ? offsetIn(before.anchor, column) : null;
    const delta = anchorAt === null ? 0 : end - anchorAt - before.anchorFromEnd;
    const lastArrival = arrivals.at(-1);
    const botArrived = Boolean(lastArrival) && lastArrival?.dataset.arrival !== "end";
    const clipOn = () => {
      if (clip) clip.style.overflowY = "clip";
    };
    const clipOffIfIdle = () => {
      if (clip && movers.current.size === 0 && risers.current.size === 0) clip.style.overflowY = "";
    };

    // any arrival: the view is at its end at once, in this frame, and nothing already on screen moves
    if (arrivals.length > 0 && following && atEnd) {
      clipOn();
      scroller.scrollTop = max;
    }
    // the composer settling under a bubble still rising (a long draft closing back to one row) is the one thing the column
    // follows on a spring, so neither the rows nor the rising bubble jump with it
    const settle = arrivals.length === 0 && (risers.current.size > 0 || movers.current.size > 0) && following && atEnd && !reduced
      && Math.abs(delta) >= 0.5 && Math.abs(delta) <= scroller.clientHeight * 1.5;
    // the column glides by `by` back to its place, on top of whatever glide it was still in
    const glide = (by: number, timingNow: Timing) => {
      if (!canAnimate(column)) return;
      clipOn();
      const current = movers.current.get(column);
      const from = (current ? remaining(current) : 0) + by;
      current?.anim.cancel();
      const anim = column.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(0px)" }], { duration: timingNow.duration, easing: timingNow.easing });
      const mover = { anim, from };
      movers.current.set(column, mover);
      anim.addEventListener("finish", () => {
        if (movers.current.get(column) === mover) movers.current.delete(column);
        clipOffIfIdle();
      });
    };
    if (settle && canAnimate(column)) {
      scroller.scrollTop = max;
      glide(delta, springTiming(SPRING_SETTLE));
    }

    // a reply landing where the working line showed grows out of it, and the view glides up to make room for it instead of
    // jumping, so nothing moves on screen in the frame the reply takes over
    let growFrom = !reduced && following && atEnd && botArrived ? before.line : null;
    const slot = column.querySelector<HTMLElement>(SLOT);
    for (const row of arrivals) {
      if (reduced) {
        if (canAnimate(row)) row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MSG_FADE.duration * 1000, easing: "ease-out" });
        continue;
      }
      if (row.dataset.arrival === "end") {
        // the person's bubble glides up a short way into its place as it fades in, and the view glides with it to make room,
        // both on one curve, so nothing jumps
        clipOn();
        const shift = scroller.scrollTop - before.scrollTop;
        if (following && atEnd && shift >= 0.5 && shift <= scroller.clientHeight * 1.5) glide(shift, sendTiming());
        const riders = [row, ...(slot && slot.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING ? [slot] : [])];
        // the slot rides under the bubble, so a status line that starts meanwhile is never under it
        for (const el of riders) {
          risers.current.add(el);
          lift(el, [`translateY(${SEND_RISE_PX}px)`, "translateY(0px)"], el === row ? [0, 1] : null, sendTiming(), () => {
            risers.current.delete(el);
            clipOffIfIdle();
          });
        }
      } else {
        const bubble = growFrom ? row.querySelector<HTMLElement>(BOT_BUBBLE) : null;
        const grown = bubble && growFrom ? growFromLine(bubble, growFrom, column) : null;
        if (grown) {
          growFrom = null;
          // the view follows the opening bubble on the same curve and clock
          const shift = scroller.scrollTop - before.scrollTop;
          if (shift >= 0.5 && shift <= scroller.clientHeight * 1.5) glide(shift, grown);
          continue;
        }
        // a bot's reply: already in view, it settles in softly while its status line fades out; a tall one barely scales
        const height = row.offsetHeight || REVEAL_SHORT_PX;
        const scale = Math.max(0.98, 1 - 6 / height);
        row.style.transformOrigin = getComputedStyle(row).direction === "rtl" ? "100% 100%" : "0 100%";
        lift(row, [`translateY(7px) scale(${scale})`, "translateY(0px) scale(1)"], [0, 1], revealTiming(height), () => {});
      }
    }

    if (slot && botArrived && canAnimate(slot)) {
      const total = LINE_BACK_AT_MS + LINE_BACK_MS;
      // opacity only: the slot may still be riding under the person's bubble on a transform
      slot.animate(
        [{ opacity: 1, easing: "ease-out" }, { opacity: 0, offset: LINE_OUT_MS / total }, { opacity: 0, offset: LINE_BACK_AT_MS / total, easing: "ease-out" }, { opacity: 1 }],
        { duration: total },
      );
    }
    clipOffIfIdle();
    take(transcriptKey);
  });
}
