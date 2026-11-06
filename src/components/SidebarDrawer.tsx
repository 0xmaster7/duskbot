import { useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { animate, motion, motionValue, type PanInfo } from "motion/react";

import { DRAWER } from "@/lib/motion-presets";

/** How far in from the start edge a swipe has to begin to open the bot list, and how far it has to travel. */
const EDGE_PX = 24;
const OPEN_PX = 40;

function startSign(element: Element | null): 1 | -1 {
  return element && getComputedStyle(element).direction === "rtl" ? -1 : 1;
}

/** The phone's bot list as a drawer: it slides in from the start edge on bencho's critically damped panel spring, follows
 * a finger that drags it back toward the edge, and on release keeps the fling's velocity, closing past a third of the
 * way or on a quick flick. The chat behind dims with how far the list is out. On a wider screen it does nothing. */
export function usePhoneDrawer({ phone, open, onClose, ref }: {
  phone: boolean;
  open: boolean;
  onClose: () => void;
  ref: RefObject<HTMLElement | null>;
}) {
  // react's own hooks only, and a plain motion value: the sidebar's tests call it as a function with those hooks stubbed
  const x = useRef(motionValue(0)).current;
  const scrim = useRef(motionValue(0)).current;
  const dragged = useRef(false);
  const width = () => ref.current?.offsetWidth || window.innerWidth;
  const sign = () => startSign(ref.current);
  const reduce = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true || document.documentElement.dataset.reducedMotion === "true";

  // the chat behind dims with how far the list is out
  useEffect(() => x.on("change", (value) => scrim.set(Math.max(0, Math.min(1, 1 + (value * sign()) / width())) * 0.34)), []);

  // the first phone render lands where it belongs, with no slide; after that open and close spring there
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!phone) { placed.current = false; x.jump(0); return; }
    const to = open ? 0 : -width() * sign();
    if (!placed.current) { placed.current = true; x.jump(to); scrim.jump(open ? 0.34 : 0); return; }
    const controls = animate(x, to, reduce() ? { duration: 0 } : DRAWER.transition);
    return () => controls.stop();
  }, [phone, open]);

  // a rotation or resize keeps a closed list just off screen
  useEffect(() => {
    if (!phone || open) return;
    const park = () => x.jump(-width() * sign());
    window.addEventListener("resize", park);
    return () => window.removeEventListener("resize", park);
  }, [phone, open]);

  if (!phone) return { props: null, scrim: null, guardClick: undefined };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const travel = -info.offset.x * sign();
    const fling = -info.velocity.x * sign();
    if (travel > width() * DRAWER.closeFraction || fling > DRAWER.closeVelocity) {
      // the close spring starts from the finger's speed, so the flick carries on rather than restarting
      animate(x, -width() * sign(), reduce() ? { duration: 0 } : { ...DRAWER.transition, velocity: info.velocity.x });
      onClose();
    } else {
      animate(x, 0, reduce() ? { duration: 0 } : { ...DRAWER.transition, velocity: info.velocity.x });
    }
    // the release that ends a drag must not also choose the row under the finger
    window.setTimeout(() => { dragged.current = false; }, 0);
  };

  return {
    props: {
      style: { x },
      drag: open ? ("x" as const) : false,
      dragDirectionLock: true,
      dragMomentum: false,
      dragElastic: 0,
      dragConstraints: sign() === 1 ? { left: -width(), right: 0 } : { left: 0, right: width() },
      onDragStart: () => { dragged.current = true; },
      onDragEnd,
    },
    scrim: (
      <motion.div
        aria-hidden
        data-drawer-scrim=""
        style={{ opacity: scrim }}
        className="pointer-events-none fixed inset-0 z-[39] bg-[rgb(23_24_26)]"
      />
    ),
    guardClick: (event: ReactMouseEvent) => {
      if (!dragged.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** A swipe in from the start edge of the chat opens the phone's bot list, the way a phone's own drawers open. */
export function useEdgeSwipeOpen(enabled: boolean, onOpen: () => void) {
  const latest = useRef(onOpen);
  latest.current = onOpen;
  useEffect(() => {
    if (!enabled) return;
    // touch events, not pointer events: the browser claims a horizontal pan and cancels the pointer before it travels
    let start: { x: number; y: number; id: number } | null = null;
    const down = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch || event.touches.length > 1) { start = null; return; }
      const rtl = startSign(document.documentElement) === -1;
      const fromEdge = rtl ? window.innerWidth - touch.clientX : touch.clientX;
      start = fromEdge <= EDGE_PX ? { x: touch.clientX, y: touch.clientY, id: touch.identifier } : null;
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      const touch = Array.from(event.changedTouches).find((entry) => entry.identifier === start?.id);
      if (!touch) return;
      const rtl = startSign(document.documentElement) === -1;
      const dx = (touch.clientX - start.x) * (rtl ? -1 : 1);
      const dy = Math.abs(touch.clientY - start.y);
      if (dy > Math.abs(dx)) { start = null; return; }
      if (dx >= OPEN_PX) { start = null; latest.current(); }
    };
    const end = () => { start = null; };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [enabled]);
}
