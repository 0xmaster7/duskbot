import { useEffect } from "react";

/** The part of the layout viewport an on-screen keyboard covers, in css px. Pinch zoom shrinks the visual viewport too,
 * so its height is scaled back first; anything under 80px is browser chrome moving, not a keyboard. */
export function keyboardInset(layoutHeight: number, visual: { height: number; scale: number }): number {
  const covered = Math.round(layoutHeight - visual.height * (visual.scale || 1));
  return covered >= 80 ? covered : 0;
}

/** Keeps the phone layout above the software keyboard. iOS (and Android without a resizing keyboard) leaves the layout
 * viewport full height and slides the page up under the keyboard instead; this sets `--keyboard-inset` on the root so
 * the app's bottom edge, and with it the composer, sits on top of the keyboard, and undoes the page slide. It also
 * registers the touch listener iOS needs before `:active` press styles apply. */
export function usePhoneViewport(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const press = () => {};
    document.addEventListener("touchstart", press, { passive: true });
    const vv = window.visualViewport;
    if (!vv) return () => document.removeEventListener("touchstart", press);
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = keyboardInset(window.innerHeight, vv);
        root.style.setProperty("--keyboard-inset", `${inset}px`);
        if (inset) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
        // the app already sits above the keyboard, so the page has nothing to slide into view
        if (inset && (window.scrollY > 0 || vv.offsetTop > 0)) window.scrollTo(0, 0);
      });
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("touchstart", press);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--keyboard-inset");
      delete root.dataset.keyboard;
    };
  }, [enabled]);
}
