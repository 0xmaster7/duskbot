// grok's timestamp peek: a sideways trackpad swipe over the transcript slides your bubbles up to 82px over and draws
// every row's time in from the edge; letting go springs it back after a 90ms pause. chat.css draws it from two
// variables on the scroller.
import { useEffect, type RefObject } from "react";
import { reducedMotion } from "@/lib/onboarding";

export const PEEK_MAX = 82;
const PEEK_SLOP = 6;
const PEEK_RELEASE_MS = 90;
const PEEK_BACK_MS = 435;
const PEEK_BACK_EASE = "linear(0, 0.03866 4%, 0.133 8%, 0.2566 12%, 0.3901 15%, 0.5206 19%, 0.6396 23%, 0.7426 27%, 0.8278 31%, 0.8954 35%, 0.9467 38%, 0.9837 42%, 1.009 46%, 1.024 50%, 1.033 54%, 1.036 58%, 1.035 62%, 1.032 65%, 1.028 69%, 1.023 73%, 1.019 77%, 1.014 81%, 1.01 85%, 1.007 88%, 1.004 92%, 1.002 96%, 1.001)";

const clamp = (value: number) => (value < 0 ? 0 : value > PEEK_MAX ? PEEK_MAX : value);

/** Whether something between the target and the scroller scrolls sideways itself: a code block or a table keeps the swipe. */
function scrollsSideways(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    if (node.scrollWidth - node.clientWidth > 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function useTimestampPeek(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let peek = 0;
    let mode: "idle" | "list" | "peek" | "scroller" = "idle";
    let dx = 0;
    let dy = 0;
    let back: Animation | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sign = () => (getComputedStyle(el).direction === "rtl" ? -1 : 1);
    const set = (value: number) => {
      peek = value;
      el.style.setProperty("--chat-ts-peek", `${value}px`);
      el.style.setProperty("--chat-ts-progress", String(value / PEEK_MAX));
    };
    const settle = () => {
      if (!back) return;
      const now = Number.parseFloat(getComputedStyle(el).getPropertyValue("--chat-ts-peek"));
      back.cancel();
      back = null;
      set(clamp(Number.isFinite(now) ? now : peek));
    };
    const done = () => {
      back = null;
      el.removeAttribute("data-peeking");
    };
    const release = () => {
      dx = 0;
      dy = 0;
      const peeking = mode === "peek";
      mode = "idle";
      if (!peeking) return;
      el.style.removeProperty("overflow-y");
      if (peek === 0 || reducedMotion() || typeof el.animate !== "function") {
        set(0);
        done();
        return;
      }
      const from = peek;
      set(0);
      back = el.animate(
        [{ "--chat-ts-peek": `${from}px`, "--chat-ts-progress": String(from / PEEK_MAX) }, { "--chat-ts-peek": "0px", "--chat-ts-progress": "0" }],
        { duration: PEEK_BACK_MS, easing: PEEK_BACK_EASE },
      );
      back.onfinish = done;
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(release, PEEK_RELEASE_MS);
    };
    const wheel = (event: WheelEvent) => {
      if (mode === "idle") {
        dx += event.deltaX;
        dy += event.deltaY;
        later();
        if (Math.max(Math.abs(dx), Math.abs(dy)) < PEEK_SLOP) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          mode = "list";
          return;
        }
        mode = scrollsSideways(event.target, el) ? "scroller" : "peek";
        if (mode === "scroller") return;
        el.setAttribute("data-peeking", "");
        el.style.overflowY = "hidden";
        settle();
        set(clamp(peek + dx * sign()));
        return;
      }
      if (mode === "list") {
        later();
        return;
      }
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      later();
      if (mode === "peek") {
        settle();
        set(clamp(peek + event.deltaX * sign()));
      }
    };
    el.addEventListener("wheel", wheel, { passive: true });
    return () => {
      clearTimeout(timer);
      back?.cancel();
      el.removeEventListener("wheel", wheel);
      el.style.removeProperty("overflow-y");
      el.style.removeProperty("--chat-ts-peek");
      el.style.removeProperty("--chat-ts-progress");
      el.removeAttribute("data-peeking");
    };
  }, [ref]);
}
