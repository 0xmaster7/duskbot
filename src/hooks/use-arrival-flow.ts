import { useLayoutEffect, useRef, type RefObject } from "react";

import { usePrefersReducedMotion } from "@/components/mascot-clock";

const ARRIVAL = "[data-arrival]";

/** Every new row, the person's or the bot's, card or bubble: inserted whole at full opacity, rising this far into place
 * (px) over ROW_ENTER_MS on ROW_ENTER_EASE, as Grok Bot's transcript does. A transcript resting at its end glides up by
 * what the rows added over the same time and curve, so nothing already on screen jumps. */
export const ROW_RISE_PX = 12;
export const ROW_ENTER_MS = 240;
export const ROW_ENTER_CURVE = [0.23, 1, 0.32, 1] as const;
export const ROW_ENTER_EASE = `cubic-bezier(${ROW_ENTER_CURVE.join(", ")})`;

/** The column's glide from where the rows were drawn to where they now rest: `from` px below its place, back to 0. */
export function columnGlide(column: HTMLElement, from: number): Animation | null {
  if (!canAnimate(column) || Math.abs(from) < 0.5) return null;
  return column.animate(
    [{ transform: `translateY(${from}px)` }, { transform: "translateY(0px)" }],
    { duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE },
  );
}

/** How far below its place the column is drawn right now, mid-glide (px). */
function glideOffset(column: HTMLElement): number {
  const transform = getComputedStyle(column).transform;
  if (!transform || transform === "none") return 0;
  const match = /matrix(3d)?\(([^)]+)\)/.exec(transform);
  if (!match) return 0;
  const parts = match[2]!.split(",").map(Number);
  const y = match[1] ? parts[13] : parts[5];
  return Number.isFinite(y) ? y! : 0;
}

interface Snapshot {
  key: string;
  /** the furthest the transcript could scroll then, and where it was scrolled */
  max: number;
  top: number;
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

/** Rows that arrive while the conversation is open. A transcript resting at its end scrolls to the new end in the frame
 * the row is inserted and the column glides up from where it was drawn (columnGlide), so the rows already on screen
 * move smoothly; a row that lands with no glide rises into place (rowEnter). The end stays pinned, with no glide, while
 * the composer changes height. A wrapper clips the column vertically while a row rises, so its transform never stretches the scroll range.
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
  const glide = useRef<Animation | null>(null);

  const take = (key: string): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    snapshot.current = { key, max: scroller.scrollHeight - scroller.clientHeight, top: scroller.scrollTop };
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
      glide.current?.cancel();
      glide.current = null;
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
    // what the rows added under a view that was resting at its end (another hook may already have pinned it there)
    const shift = before.top >= before.max - 2 ? Math.max(0, max - before.max) : 0;

    const track = (anim: Animation) => {
      if (clip) clip.style.overflowY = "clip";
      rising.current.add(anim);
      anim.addEventListener("finish", () => {
        rising.current.delete(anim);
        if (clip && rising.current.size === 0) clip.style.overflowY = "";
      });
    };
    // scrolled up, a new row lands below the view: nothing on screen moves
    if (!reduced && following && atEnd && arrivals.length > 0) {
      // the rows on screen glide up by what the arrivals added instead of jumping there in one frame; a glide still
      // running carries on from where it is drawn now
      const carried = glide.current ? glideOffset(column) : 0;
      if (glide.current) { glide.current.cancel(); rising.current.delete(glide.current); glide.current = null; }
      const glided = columnGlide(column, shift + carried);
      if (glided) {
        glide.current = glided;
        glided.addEventListener("finish", () => { if (glide.current === glided) glide.current = null; });
        track(glided);
      }
      // a row the column carries up needs no rise of its own; one landing with no glide (room already there) rises
      for (const row of glided ? [] : arrivals) {
        const anim = rowEnter(row);
        if (anim) track(anim);
      }
    }
    if (clip && rising.current.size === 0) clip.style.overflowY = "";
    take(transcriptKey);
  });
}
