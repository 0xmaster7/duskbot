import { useLayoutEffect, useRef, type RefObject } from "react";

import { usePrefersReducedMotion } from "@/components/mascot-clock";

const ARRIVAL = "[data-arrival]";

/** Every new row, the person's or the bot's, card or bubble: inserted whole at full opacity, rising this far into place
 * (px) over ROW_ENTER_MS on ROW_ENTER_EASE, as Grok Bot's transcript does. */
export const ROW_RISE_PX = 12;
export const ROW_ENTER_MS = 240;
export const ROW_ENTER_CURVE = [0.23, 1, 0.32, 1] as const;
export const ROW_ENTER_EASE = `cubic-bezier(${ROW_ENTER_CURVE.join(", ")})`;

interface Snapshot {
  key: string;
  /** the furthest the transcript could scroll then */
  max: number;
}

const canAnimate = (el: Element) => typeof (el as HTMLElement).animate === "function";

/** One row's entrance: the same rise for every row type, no fade, no scale, no stagger. */
export function rowEnter(row: HTMLElement): Animation | null {
  if (!canAnimate(row)) return null;
  return row.animate(
    [{ transform: `translateY(${ROW_RISE_PX}px)` }, { transform: "translateY(0px)" }],
    { duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE },
  );
}

/** Rows that arrive while the conversation is open. Each new row rises into place (rowEnter); a transcript resting at
 * its end jumps to the new end in the frame the row is inserted, and stays pinned there while the composer changes
 * height. A wrapper clips the column vertically while a row rises, so its transform never stretches the scroll range.
 * Scrolled up, nothing moves the view. Under reduced motion rows simply appear. */
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
  const rising = useRef(new Set<Animation>());
  const played = useRef(new WeakSet<Element>());

  const take = (key: string): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    snapshot.current = { key, max: scroller.scrollHeight - scroller.clientHeight };
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

  // a conversation left (or the transcript gone) drops whatever was still rising
  useLayoutEffect(() => {
    const all = rising.current;
    const clip = clipRef.current;
    return () => {
      for (const anim of all) anim.cancel();
      all.clear();
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

    const max = scroller.scrollHeight - scroller.clientHeight;
    // a transcript resting at its end stays there; mid-scroll (a jump to the latest in progress) is left alone
    const atEnd = scroller.scrollTop >= Math.min(before.max, max) - 2;
    if (following && atEnd && scroller.scrollTop !== max) scroller.scrollTop = max;

    // scrolled up, a new row lands below the view: nothing on screen moves
    if (!reduced && following && atEnd) {
      for (const row of arrivals) {
        const anim = rowEnter(row);
        if (!anim) continue;
        if (clip) clip.style.overflowY = "clip";
        rising.current.add(anim);
        anim.addEventListener("finish", () => {
          rising.current.delete(anim);
          if (clip && rising.current.size === 0) clip.style.overflowY = "";
        });
      }
    }
    take(transcriptKey);
  });
}
