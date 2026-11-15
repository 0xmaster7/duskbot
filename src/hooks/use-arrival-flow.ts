import { useLayoutEffect, useRef, type RefObject } from "react";

import { usePrefersReducedMotion } from "@/components/mascot-clock";

const ARRIVAL = "[data-arrival]";

/** A new row with no entrance of its own (a card, a chip): inserted whole at full opacity, rising this far into place (px)
 * over ROW_ENTER_MS on ROW_ENTER_EASE. */
export const ROW_RISE_PX = 12;
export const ROW_ENTER_MS = 240;
export const ROW_ENTER_CURVE = [0.23, 1, 0.32, 1] as const;
export const ROW_ENTER_EASE = `cubic-bezier(${ROW_ENTER_CURVE.join(", ")})`;

/** A row that plays its own entrance (a bubble carried out of the composer, a reply growing out of the mascot): the
 * column still follows it, but it does not rise as well. */
export const OWN_ENTRANCE = "data-arrival-own";

/** How far under the header a sent message settles (px). */
export const ROOM_TOP_GAP = 16;

/** The room a person's send makes for its turn, as Grok and ChatGPT do: the column is kept tall enough that, at its end,
 * the sent message sits just under the header and the turn's rows fill free space below it. While the room is held the
 * view does not follow the end, so nothing above moves as the reply is typed and lands, and a reply taller than the room
 * runs on below the view. */
export interface TurnRoom { held: boolean }

/** Makes the room for `row`, just sent: the column's min-height grows so the row sits ROOM_TOP_GAP under the header when
 * the view is at its end. False when the turn already needs no room. */
export function makeTurnRoom(scroller: HTMLElement, column: HTMLElement, row: HTMLElement): boolean {
  // the rows are packed at the column's top, so an earlier room's min-height moves none of them: measure with it in place
  // rather than dropping it first, which would clamp the scroll position under the measurement
  const header = parseFloat(getComputedStyle(scroller).getPropertyValue("--glass-top")) || 0;
  const rowTop = row.getBoundingClientRect().top - glideOffset(column);
  const settled = scroller.getBoundingClientRect().top + header + ROOM_TOP_GAP;
  const extra = scroller.scrollTop + (rowTop - settled) - (scroller.scrollHeight - scroller.clientHeight);
  const tall = column.offsetHeight + extra;
  if (tall <= column.offsetHeight - roomLeft(column) + 0.5) return false;
  column.style.minHeight = `${tall}px`;
  return true;
}

/** The part of the room the turn's rows have not filled (px). */
export function roomLeft(column: HTMLElement): number {
  const kept = column.style.minHeight;
  if (!kept) return 0;
  const tall = column.offsetHeight;
  column.style.minHeight = "";
  const natural = column.offsetHeight;
  column.style.minHeight = kept;
  return Math.max(0, tall - natural);
}

/** Lets the room go once its empty part is out of view below, so it never leaves a blank band to scroll into and
 * nothing on screen moves when it goes. */
export function releaseRoomOutOfView(scroller: HTMLElement, column: HTMLElement): void {
  const left = roomLeft(column);
  if (!column.style.minHeight) return;
  if (left < 0.5 || scroller.scrollTop + scroller.clientHeight <= scroller.scrollHeight - left + 0.5) column.style.minHeight = "";
}

export interface SpringTiming { duration: number; easing: string }

/** A spring from rest at 0 to rest at 1 (mass 1) as a WAAPI duration and linear() easing, so it runs off the main thread
 * and a glide cut short can be read back from the computed transform. */
export function springTiming(stiffness: number, damping: number): SpringTiming {
  const w = Math.sqrt(stiffness);
  const z = Math.min(1, damping / (2 * w));
  const wd = w * Math.sqrt(1 - z * z);
  const at = (t: number) => z >= 1 ? 1 - (1 + w * t) * Math.exp(-w * t)
    : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  const envelope = (t: number) => z >= 1 ? (1 + w * t) * Math.exp(-w * t) : Math.exp(-z * w * t) / Math.sqrt(1 - z * z);
  let end = 0.05;
  while (envelope(end) > 0.001 && end < 2) end += 0.005;
  const steps = 48;
  const points = Array.from({ length: steps + 1 }, (_, i) => i === steps ? "1" : String(Math.round(at((end * i) / steps) * 10000) / 10000));
  return { duration: Math.round(end * 1000), easing: `linear(${points.join(", ")})` };
}

/** motion's { type: "spring", bounce, visualDuration } in stiffness and damping */
export function visualSpring(visualDuration: number, bounce = 0): SpringTiming {
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  return springTiming(root * root, 2 * Math.min(1, Math.max(0.05, 1 - bounce)) * root);
}

/** How a transcript resting at its end follows a new row: a 0.3s spring with no bounce. */
export const FOLLOW = visualSpring(0.3);

/** The column's glide from where the rows were drawn to where they now rest: `from` px below its place, back to 0. */
export function columnGlide(column: HTMLElement, from: number): Animation | null {
  if (!canAnimate(column) || Math.abs(from) < 0.5) return null;
  return column.animate(
    [{ transform: `translateY(${from}px)` }, { transform: "translateY(0px)" }],
    { duration: FOLLOW.duration, easing: FOLLOW.easing },
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

/** One row's entrance: a rise with no fade, no scale and no stagger. */
export function rowEnter(row: HTMLElement): Animation | null {
  if (!canAnimate(row)) return null;
  return row.animate(
    [{ transform: `translateY(${ROW_RISE_PX}px)` }, { transform: "translateY(0px)" }],
    { duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE },
  );
}

/** Rows that arrive while the conversation is open. A transcript resting at its end scrolls to the new end in the frame
 * the row is inserted and the column glides up from where it was drawn (columnGlide), so the rows already on screen
 * move smoothly; a row that lands with no glide rises into place (rowEnter) unless it plays its own entrance. The end stays pinned, with no glide, while
 * the composer changes height. A wrapper clips the column vertically while a row rises, so its transform never stretches the scroll range.
 * Scrolled up, nothing moves the view. Under reduced motion rows simply appear. */
export function useArrivalFlow({
  scrollRef,
  clipRef,
  columnRef,
  transcriptKey,
  following,
  room,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  clipRef: RefObject<HTMLElement | null>;
  columnRef: RefObject<HTMLElement | null>;
  transcriptKey: string;
  following: boolean;
  room: RefObject<TurnRoom>;
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
    // and so does the person's scrolling, so a send's slide starts from where the view really is
    const onScroll = () => take(transcriptKey);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); scroller.removeEventListener("scroll", onScroll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- take reads refs only
  }, [scrollRef, columnRef, transcriptKey]);

  // a conversation left (or the transcript gone) drops whatever was still rising
  useLayoutEffect(() => {
    const all = rising.current;
    const clip = clipRef.current;
    const column = columnRef.current;
    return () => {
      room.current.held = false;
      if (column) column.style.minHeight = "";
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

    const resting = before.top >= before.max - 2;
    // a send while the view follows the conversation (at its end, or held on a long reply running on below it) makes its
    // turn's room; any other send ends the room before it
    const sent = arrivals.find((row) => row.getAttribute("data-arrival") === "end");
    const madeRoom = Boolean(sent && following && makeTurnRoom(scroller, column, sent));
    if (sent) room.current.held = madeRoom;
    const held = room.current.held && !madeRoom;

    const max = scroller.scrollHeight - scroller.clientHeight;
    // a transcript resting at its end stays there; mid-scroll (a jump to the latest in progress) is left alone
    const atEnd = madeRoom || scroller.scrollTop >= Math.min(before.max, max) - 2;
    if (following && atEnd && !held && scroller.scrollTop !== max) scroller.scrollTop = max;
    // what the rows added under a view that was resting at its end (another hook may already have pinned it there)
    const shift = madeRoom ? Math.max(0, max - before.top) : resting && !held ? Math.max(0, max - before.max) : 0;

    const track = (anim: Animation) => {
      if (clip) clip.style.overflowY = "clip";
      rising.current.add(anim);
      anim.addEventListener("finish", () => {
        rising.current.delete(anim);
        if (clip && rising.current.size === 0) clip.style.overflowY = "";
      });
    };
    // scrolled up, a new row lands below the view: nothing on screen moves
    if (!reduced && held && arrivals.length > 0) {
      // in the turn's room the view holds still: a row with no entrance of its own rises into the room
      for (const row of arrivals.filter((one) => !one.hasAttribute(OWN_ENTRANCE))) {
        const anim = rowEnter(row);
        if (anim) track(anim);
      }
    } else if (!reduced && following && atEnd && arrivals.length > 0) {
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
      for (const row of glided ? [] : arrivals.filter((one) => !one.hasAttribute(OWN_ENTRANCE))) {
        const anim = rowEnter(row);
        if (anim) track(anim);
      }
    }
    if (clip && rising.current.size === 0) clip.style.overflowY = "";
    take(transcriptKey);
  });
}
