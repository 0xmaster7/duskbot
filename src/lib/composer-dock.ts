import { useLayoutEffect, useState, type RefObject } from "react";

/** Must equal Tailwind `gap-3` on the transcript stack. */
export const TRANSCRIPT_GAP = "0.75rem";

const FALLBACK_COMPOSER_PX = 64;

export function transcriptEndPad(composerHeightPx: number): string {
  const height = Number.isFinite(composerHeightPx)
    ? Math.max(0, Math.ceil(composerHeightPx))
    : FALLBACK_COMPOSER_PX;
  return `calc(${height}px + ${TRANSCRIPT_GAP})`;
}

export function useComposerDockPad(ref: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // the pill springs between one row and several; the transcript keeps the height it is settling to, so it moves once
    // instead of on every frame of the spring
    const apply = () => {
      const pill = el.querySelector<HTMLElement>(".composer-pill");
      const settling = pill?.style.height ? parseFloat(pill.style.height) - pill.getBoundingClientRect().height : 0;
      setHeight(el.getBoundingClientRect().height + (Number.isFinite(settling) ? settling : 0));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  const measured = height > 0 ? height : FALLBACK_COMPOSER_PX;
  return { pad: transcriptEndPad(measured), height: measured };
}
