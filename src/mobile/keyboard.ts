import { useEffect, type RefObject } from "react";
import { keyboardInset } from "@/lib/phone-viewport";
import { keyboardCurve, prefersReducedMotion } from "./motion";
import type { MobilePlatform } from "./platform";

/** The open chat's transcript scroller, kept still on screen while the layout under it changes. */
function scroller(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-mobile-chat] .glass-scroller");
}

function safeBottom(root: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--m-safe-bottom)";
  root.appendChild(probe);
  const value = probe.getBoundingClientRect().height;
  probe.remove();
  return value;
}

/** Moves the chat with the software keyboard. Natively the keyboard announces itself before it moves, so the transcript
 * and composer ride up on the compositor with the keyboard's own curve, and the layout takes the space only once it has
 * settled (and gives it back before it leaves), each swap paired with a scroll offset so nothing visibly jumps. In a
 * browser the visual viewport is the only signal and the browser already animates it, so the inset simply follows. */
export function useKeyboardSync(platform: MobilePlatform, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const curve = platform.kind === "android" ? keyboardCurve.android : keyboardCurve.ios;
    root.style.setProperty("--m-kb-dur", `${prefersReducedMotion() ? 0.01 : curve.duration}s`);
    root.style.setProperty("--m-kb-ease", curve.css);
    let committed = 0;
    let settleTimer = 0;

    const set = (kb: number, shift: number) => {
      root.style.setProperty("--m-kb", `${kb}px`);
      root.style.setProperty("--m-kb-shift", `${shift}px`);
    };
    const commitShown = (height: number) => {
      window.clearTimeout(settleTimer);
      if (committed === height) return;
      const shift = Math.max(0, height - safeBottom(root));
      delete root.dataset.kbMoving;
      const list = scroller(root);
      set(height, 0);
      if (list) list.scrollTop += shift - Math.max(0, committed - safeBottom(root));
      committed = height;
    };

    // android resizes the whole webview with the window (adjustResize; the keyboard plugin's resize mode is ios only), so
    // there the layout already ends at the keyboard and only ios gets the ride-along choreography
    if (platform.kind === "android") return;
    if (platform.onKeyboard) {
      const stop = platform.onKeyboard(({ height, phase }) => {
        if (height > 0) {
          if (phase === "did") { commitShown(height); return; }
          const shift = Math.max(0, height - Math.max(committed, safeBottom(root)));
          root.dataset.kbMoving = "";
          root.dataset.keyboard = "open";
          root.style.setProperty("--m-kb-shift", `${shift}px`);
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(() => commitShown(height), curve.duration * 1000 + 40);
          return;
        }
        if (phase === "did") { delete root.dataset.kbMoving; return; }
        window.clearTimeout(settleTimer);
        const shift = Math.max(0, committed - safeBottom(root));
        delete root.dataset.kbMoving;
        delete root.dataset.keyboard;
        const list = scroller(root);
        set(0, shift);
        if (list) list.scrollTop -= shift;
        committed = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          root.dataset.kbMoving = "";
          root.style.setProperty("--m-kb-shift", "0px");
        }));
      });
      return () => { stop(); window.clearTimeout(settleTimer); };
    }

    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = keyboardInset(window.innerHeight, vv);
        set(inset, 0);
        if (inset) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
        if (inset && (window.scrollY > 0 || vv.offsetTop > 0)) window.scrollTo(0, 0);
      });
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [platform, rootRef]);
}
