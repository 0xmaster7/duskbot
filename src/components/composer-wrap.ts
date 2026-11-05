import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Simple: anything that grows the pill past its one 44px row (a second line, a reply strip) rounds its corners in. */
export function useTallPill(shellRef: RefObject<HTMLDivElement | null>, on: boolean): boolean {
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!on || !shell || typeof ResizeObserver === "undefined") return;
    const measure = () => setTall(shell.getBoundingClientRect().height > 44.5);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [shellRef, on]);
  return tall;
}

/**
 * Simple: the pill's height in pixels, so a new line or a reply strip grows it with a transition instead of a jump. The
 * content sits at the pill's bottom and is clipped while the pill grows to it.
 */
export function usePillHeight(shellRef: RefObject<HTMLDivElement | null>, contentRef: RefObject<HTMLDivElement | null>, on: boolean): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const content = contentRef.current;
    if (!on || !shell || !content || typeof ResizeObserver === "undefined") {
      setHeight(undefined);
      return;
    }
    let last: number | undefined;
    let settle = 0;
    const done = () => {
      window.clearTimeout(settle);
      delete shell.dataset.growing;
    };
    const measure = () => {
      const style = getComputedStyle(shell);
      const next = Math.ceil(content.offsetHeight + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0));
      if (next === last) return;
      if (last !== undefined && next > last) {
        shell.dataset.growing = "";
        window.clearTimeout(settle);
        settle = window.setTimeout(done, 400);
      }
      last = next;
      setHeight(next);
    };
    const ended = (event: TransitionEvent) => {
      if (event.target === shell && event.propertyName === "height") done();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    shell.addEventListener("transitionend", ended);
    shell.addEventListener("transitioncancel", ended);
    return () => {
      observer.disconnect();
      shell.removeEventListener("transitionend", ended);
      shell.removeEventListener("transitioncancel", ended);
      done();
    };
  }, [shellRef, contentRef, on]);
  return on ? height : undefined;
}

/**
 * Advanced: a message past one line takes the composer's full width above the buttons instead of wrapping in the gap
 * between them. `wrapAt` is the length at which the one-row field wrapped; the field goes back beside the buttons
 * only below it, so wider text on its own line cannot flip back and forth.
 */
export function useStackedField(inputRef: RefObject<HTMLTextAreaElement | null>, on: boolean, text: string): boolean {
  const [wrapAt, setWrapAt] = useState<number | null>(null);
  const stacked = on && (text.includes("\n") || (wrapAt !== null && text.length >= wrapAt));
  // Width changes (a resized window, a panel opening) can wrap the one-row field too, so watch its size, not just the text.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!on || stacked || !input || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // An empty field's height is its placeholder's, which may wrap; that is not a message. The next message measures afresh.
      if (!input.value) return setWrapAt(null);
      const style = getComputedStyle(input);
      const line = parseFloat(style.lineHeight) || 24;
      const content = input.scrollHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      if (content > line * 1.5) setWrapAt(input.value.length);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    return () => observer.disconnect();
  }, [inputRef, on, stacked, text]);
  return stacked;
}

function movesLess(): boolean {
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Slides an element from where it was to where it is whenever `key` changes, on the pill's own spring. */
export function useSlideOnChange(target: () => HTMLElement | null | undefined, key: unknown, on: boolean): void {
  const last = useRef<DOMRect | null>(null);
  const lastKey = useRef(key);
  useLayoutEffect(() => {
    const element = target();
    if (!element) {
      last.current = null;
      return;
    }
    const rect = element.getBoundingClientRect();
    const before = last.current;
    const changed = lastKey.current !== key;
    last.current = rect;
    lastKey.current = key;
    if (!on || !changed || !before || typeof element.animate !== "function" || movesLess()) return;
    const dx = before.left - rect.left;
    const dy = before.top - rect.top;
    if (!dx && !dy) return;
    const easing = getComputedStyle(document.documentElement).getPropertyValue("--composer-spring").trim() || "ease-out";
    element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing });
  });
}
