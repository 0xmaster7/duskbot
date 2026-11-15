// The Connect an AI flow's motion: a panel that grows in out of the pressed card and folds back into it (Reveal), and a
// box that springs to its height while one stage rises in over the last (StageSwap). Reduced motion keeps the fades only.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import "../../styles/connect.css";

/** How long a folding panel or a fading stage stays before it leaves; the css runs a little shorter. */
export const CONNECT_LEAVE_MS = 260;
/** How long the stage box springs to its new height (connect.css, 300/22) before it goes back to auto. */
const CONNECT_HEIGHT_MS = 640;

/** Grows its content in (height and opacity) when it gets some, and folds it away when it loses it, keeping the last
 * content on screen, inert, until the fold ends. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const shown = Boolean(children);
  const [kept, setKept] = useState<ReactNode>(children);
  if (shown && kept !== children) setKept(children);
  const leaving = !shown && Boolean(kept);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setKept(null), CONNECT_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  if (!shown && !kept) return null;
  return (
    <div className="connect-reveal w-full" data-leaving={leaving ? "" : undefined} inert={leaving || undefined} aria-hidden={leaving || undefined}>
      <div className="connect-reveal-inner"><div className={className}>{shown ? children : kept}</div></div>
    </div>
  );
}

/** A picture of what was there, held still: no ids or data attributes, so nothing finds it as the live stage. */
function stillCopy(node: HTMLElement | null): Node | null {
  if (!node) return null;
  const copy = node.cloneNode(true) as HTMLElement;
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    for (const name of element.getAttributeNames()) if (name === "id" || name.startsWith("data-")) element.removeAttribute(name);
    // a copied node starts its css animations over: a stage that faded in would vanish and fade in again
    (element as HTMLElement).style.animation = "none";
  }
  return copy;
}

/** One stage at a time, by `stage`: a new one fades and rises in over a still copy of the old one fading out, while the
 * box eases from the old height to the new, so nothing under it jumps. The copy is plain DOM, so nothing in it runs again. */
export function StageSwap({ stage, children, className }: { stage: string; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const [swap, setSwap] = useState({ stage, from: null as Node | null, fromHeight: null as number | null, swaps: 0 });
  if (swap.stage !== stage) {
    setSwap({ stage, from: stillCopy(current.current), fromHeight: box.current?.offsetHeight ?? null, swaps: swap.swaps + 1 });
  }
  const { from, fromHeight, swaps } = swap;
  // only a swap eases the height, from the old one to the new; between swaps it is auto, so a box inside can grow freely
  useLayoutEffect(() => {
    const element = box.current;
    if (!swaps || fromHeight === null || !element || !current.current) return;
    element.style.height = `${fromHeight}px`;
    void element.offsetHeight;
    element.style.height = `${current.current.offsetHeight}px`;
    const timer = setTimeout(() => { element.style.height = ""; }, CONNECT_HEIGHT_MS);
    return () => clearTimeout(timer);
  }, [swaps]);
  useEffect(() => {
    if (!from) return;
    const timer = setTimeout(() => setSwap((now) => (now.swaps === swaps ? { ...now, from: null } : now)), CONNECT_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [from, swaps]);
  const ghost = useCallback((node: HTMLDivElement | null) => { if (node && from) node.replaceChildren(from); }, [from]);
  return (
    <div ref={box} className={cn("connect-stage-box", className)}>
      <div key={swaps} ref={current} className={swaps ? "connect-stage-in" : undefined}>{children}</div>
      {from && <div key={`from-${swaps}`} ref={ghost} aria-hidden="true" inert className="connect-stage-out" />}
    </div>
  );
}
