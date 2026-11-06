import { spring } from "motion/react";
import { useLayoutEffect, useRef, type RefObject } from "react";

import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { MSG_FADE, SPRING_SETTLE, SWAP_BLUR_PX } from "@/lib/motion-presets";

const ROW = "[data-message-row]";
const SLOT = ".turn-status-slot";
const ARRIVAL = "[data-arrival]";
const COMPOSER = '[data-tour="composer"]';

/** How far below its place the person's own bubble starts: from the composer's top edge, kept within these bounds. */
export const RISE_PX = [64, 140] as const;
/** The status line's hand-off to a bubble: it fades out as the bubble fades in at its spot, and if it still has work to
 * report, it comes back in its slot once the bubble has risen clear (ms). */
const LINE_OUT_MS = 160;
const LINE_BACK_AT_MS = 300;
const LINE_BACK_MS = 160;

let timing: { duration: number; easing: string } | null = null;

/** The settle spring as a Web Animations timing, sampled every 8ms into `linear()`: the compositor runs it, it applies in
 * the frame it starts, and every mover shares one curve and clock. */
export function settleTiming(): { duration: number; easing: string } {
  if (timing) return timing;
  const { stiffness, damping, mass } = SPRING_SETTLE;
  const gen = spring({ keyframes: [0, 1], stiffness, damping, mass, restDelta: 0.0005, restSpeed: 0.005 });
  const points: number[] = [];
  let t = 0;
  for (; t <= 2000; t += 8) {
    const step = gen.next(t);
    points.push(Math.round(step.value * 10000) / 10000);
    if (step.done) break;
  }
  points[points.length - 1] = 1;
  timing = { duration: t, easing: `linear(${points.join(", ")})` };
  return timing;
}

interface Snapshot {
  key: string;
  anchor: HTMLElement | null;
  /** distance from the anchor's top to the end of the scrolled content */
  anchorFromEnd: number;
  slot: HTMLElement | null;
  slotFromEnd: number;
  /** the furthest the transcript could scroll then */
  max: number;
}

interface Mover {
  anim: Animation;
  from: number;
}

/** Top of `el` inside `column`, from layout alone (offsetTop ignores transforms, so moves in flight never count). */
function offsetIn(el: HTMLElement, column: HTMLElement): number | null {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== column) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === column ? y : null;
}

const canAnimate = (el: Element) => typeof (el as HTMLElement).animate === "function";

/** Where an in-flight mover is now, read from its own timing rather than the computed style. */
function remaining(mover: Mover): number {
  if (mover.anim.playState === "finished" || mover.anim.playState === "idle") return 0;
  const progress = mover.anim.effect?.getComputedTiming().progress;
  return mover.from * (1 - (typeof progress === "number" ? progress : 1));
}

/** Rows that arrive while the conversation is open move as one, and the scroll never takes part.
 *
 * While the transcript follows its end, the scroll jumps once to the new end before the frame paints; whatever that moved
 * (rows added, a row grown, the composer settling) is drawn back where it was by a transform on the column, and one spring
 * carries it home. A wrapper clips the column vertically while it moves, so the transform never stretches the scroll range
 * and nothing follows a moving end. The person's own bubble starts at the composer's top edge and rises with everything
 * else; a bot's bubble fades in where its status line was as the line fades out, and a line with more to report comes back
 * in its slot below. Scrolled up, nothing on screen moves. Under reduced motion new rows only fade in. */
export function useArrivalFlow({
  scrollRef,
  clipRef,
  columnRef,
  composerRef,
  transcriptKey,
  following,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  clipRef: RefObject<HTMLElement | null>;
  columnRef: RefObject<HTMLElement | null>;
  composerRef?: RefObject<HTMLElement | null>;
  transcriptKey: string;
  following: boolean;
}): void {
  const reduced = usePrefersReducedMotion();
  const snapshot = useRef<Snapshot | null>(null);
  const movers = useRef(new Map<HTMLElement, Mover>());
  const played = useRef(new WeakSet<Element>());

  const take = (key: string): void => {
    const scroller = scrollRef.current, column = columnRef.current;
    if (!scroller || !column) return;
    const anchor = (column.querySelectorAll<HTMLElement>(ROW).item(column.querySelectorAll(ROW).length - 1) as HTMLElement | null) ?? null;
    const slot = column.querySelector<HTMLElement>(SLOT);
    const end = scroller.scrollHeight;
    const anchorAt = anchor ? offsetIn(anchor, column) : null;
    const slotAt = slot ? offsetIn(slot, column) : null;
    snapshot.current = { key, anchor: anchorAt === null ? null : anchor, anchorFromEnd: end - (anchorAt ?? 0), slot: slotAt === null ? null : slot, slotFromEnd: end - (slotAt ?? 0), max: end - scroller.clientHeight };
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

  useLayoutEffect(() => {
    const all = movers.current;
    const clip = clipRef.current;
    return () => {
      for (const mover of all.values()) mover.anim.cancel();
      all.clear();
      if (clip) clip.style.overflowY = "";
    };
  }, [clipRef, transcriptKey]);

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
    // only a transcript resting at its end glides; mid-scroll (a jump to the latest in progress) is left alone
    const atEnd = scroller.scrollTop >= Math.min(before.max, max) - 2;
    const anchorAt = before.anchor?.isConnected ? offsetIn(before.anchor, column) : null;
    const delta = anchorAt === null ? 0 : end - anchorAt - before.anchorFromEnd;
    // only a live arrival (or the composer settling under one still moving) glides: history, a thread's snapshot and a
    // chat that just opened land in place
    const live = arrivals.length > 0 || movers.current.size > 0;
    const glide = live && following && atEnd && !reduced && Math.abs(delta) >= 0.5 && Math.abs(delta) <= scroller.clientHeight * 1.5;

    const lastArrival = arrivals.at(-1);
    const own = lastArrival?.dataset.arrival === "end";
    const botArrived = Boolean(lastArrival) && !own;
    const slot = column.querySelector<HTMLElement>(SLOT);
    const slotAt = slot ? offsetIn(slot, column) : null;

    // the bubble's own entrance: the person's from the composer, a bot's out of its status line
    const timingNow = settleTiming();
    const offsets = new Map<HTMLElement, number>();
    if (glide) offsets.set(column, delta);
    let rise = 0;
    for (const row of arrivals) {
      if (!canAnimate(row)) continue;
      if (reduced) {
        row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MSG_FADE.duration * 1000, easing: "ease-out" });
        continue;
      }
      if (row.dataset.arrival === "end") {
        const rowAt = offsetIn(row, column);
        const composer = composerRef?.current?.querySelector<HTMLElement>(COMPOSER) ?? composerRef?.current ?? null;
        const moving = movers.current.get(column);
        const columnTop = column.getBoundingClientRect().top - (moving ? remaining(moving) : 0) + scroller.scrollTop - (following ? max : scroller.scrollTop);
        const finalTop = rowAt === null ? null : columnTop + rowAt;
        const fromComposer = composer && finalTop !== null ? composer.getBoundingClientRect().top - finalTop : RISE_PX[0];
        const total = Math.min(RISE_PX[1], Math.max(RISE_PX[0], fromComposer));
        rise = Math.max(0, total - (glide ? delta : 0));
        if (rise > 0) offsets.set(row, rise);
        row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MSG_FADE.duration * 1000, easing: "ease-out" });
      } else {
        row.style.transformOrigin = getComputedStyle(row).direction === "rtl" ? "100% 0" : "0 0";
        row.animate([{ transform: "scale(0.97)" }, { transform: "none" }], { duration: timingNow.duration, easing: timingNow.easing });
        row.animate([{ opacity: 0, filter: `blur(${SWAP_BLUR_PX}px)` }, { opacity: 1, filter: "blur(0px)" }], { duration: MSG_FADE.duration * 1000, easing: "ease-out" });
      }
    }

    if (slot && slotAt !== null && before.slot === slot && !reduced) {
      if (botArrived) {
        // the line stays where it was while the bubble takes its place, then settles into its slot below
        const slotShift = (end - slotAt) - before.slotFromEnd;
        const hold = slotShift - (glide ? delta : 0);
        if (Math.abs(hold) >= 0.5) offsets.set(slot, hold);
      } else if (own && rise > 0) {
        // the slot rides under the person's bubble, so a line that starts meanwhile is never under it
        offsets.set(slot, rise);
      }
    }
    if (slot && botArrived && canAnimate(slot)) {
      const total = LINE_BACK_AT_MS + LINE_BACK_MS;
      slot.animate(
        reduced
          ? [{ opacity: 1, easing: "ease-out" }, { opacity: 0, offset: LINE_OUT_MS / total }, { opacity: 0, offset: LINE_BACK_AT_MS / total, easing: "ease-out" }, { opacity: 1 }]
          : [
              { opacity: 1, filter: "blur(0px)", easing: "ease-out" },
              { opacity: 0, filter: `blur(${SWAP_BLUR_PX}px)`, offset: LINE_OUT_MS / total },
              { opacity: 0, filter: "blur(0px)", offset: LINE_BACK_AT_MS / total, easing: "ease-out" },
              { opacity: 1, filter: "none" },
            ],
        { duration: total },
      );
    }

    if (offsets.size > 0) {
      // the clip goes on before anything moves, so the scroll range never includes a transform
      if (clip) clip.style.overflowY = "clip";
      if (glide) scroller.scrollTop = max;
      // every mover restarts on one clock from where it is now, so the column and the rows inside it never drift apart
      const all = movers.current;
      for (const el of all.keys()) if (!offsets.has(el)) offsets.set(el, 0);
      for (const [el, add] of offsets) {
        const current = all.get(el);
        const from = (current ? remaining(current) : 0) + add;
        current?.anim.cancel();
        all.delete(el);
        if (Math.abs(from) < 0.5 || !canAnimate(el)) continue;
        const anim = el.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(0px)" }], { duration: timingNow.duration, easing: timingNow.easing });
        const mover = { anim, from };
        all.set(el, mover);
        const done = () => {
          if (all.get(el) !== mover) return;
          all.delete(el);
          if (all.size === 0 && clip) clip.style.overflowY = "";
        };
        anim.addEventListener("finish", done);
      }
      if (all.size === 0 && clip) clip.style.overflowY = "";
    }
    take(transcriptKey);
  });
}
