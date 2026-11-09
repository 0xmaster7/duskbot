import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { useBotPointer } from "@/lib/bot-pointer";
import "./bot-pointer.css";

/** As long as the driver kept its own cursor up after the bot's last action. */
const IDLE_MS = 15_000;

interface Fit { left: number; top: number; scale: number }

/** Where the desktop's picture sits inside `host`, and its scale from desktop pixels. */
function fitOf(host: HTMLElement): Fit | null {
  const canvas = host.querySelector("canvas");
  if (!canvas?.width || !canvas.clientWidth) return null;
  const outer = host.getBoundingClientRect();
  const inner = canvas.getBoundingClientRect();
  return { left: inner.left - outer.left, top: inner.top - outer.top, scale: inner.width / canvas.width };
}

/** The bot's pointer over its live computer: one small arrow that glides to wherever the bot acts, with a faint ring when
 * it presses. The desktop draws no pointer of its own, so this is the only one in view. */
export function BotPointer({ host, botId }: { host: RefObject<HTMLElement | null>; botId: string }) {
  const pointer = useBotPointer(botId);
  const [fit, setFit] = useState<Fit | null>(null);
  const [idleSequence, setIdleSequence] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setFit(fitOf(element));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const canvas = element.querySelector("canvas");
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, [host]);

  useEffect(() => {
    if (!pointer) return;
    const left = pointer.at + IDLE_MS - Date.now();
    const timer = window.setTimeout(() => setIdleSequence(pointer.sequence), Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [pointer]);

  if (!pointer || !fit) return null;
  const x = fit.left + pointer.x * fit.scale;
  const y = fit.top + pointer.y * fit.scale;
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden="true">
      {/* the press ring waits at the spot for the arrow to arrive, then fades */}
      {pointer.phase === "click" && (
        <span key={pointer.sequence} className="absolute left-0 top-0" style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}>
          <span className="bot-pointer-press -ml-[7px] -mt-[7px] block size-3.5 rounded-full border-[1.5px] border-[rgb(20_20_20/0.55)] shadow-[0_0_0_1px_rgb(250_250_250/0.5)]" />
        </span>
      )}
      <div data-bot-pointer={pointer.phase} className="bot-pointer absolute left-0 top-0"
        style={{ transform: `translate3d(${x}px, ${y}px, 0)`, opacity: idleSequence === pointer.sequence ? 0 : 1 }}>
        {/* the tip is the hotspot: the arrow is drawn 1:1 in css pixels from the point (1, 1) */}
        <svg width="14" height="21" viewBox="0 0 14 21" className="absolute -left-px -top-px drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.35)]">
          <path d="M1 1v15.5l3.7-3.5 2.6 6 2.3-1-2.6-5.8H12z" fill="#141414" stroke="#fafafa" strokeWidth="1.6" strokeLinejoin="round" style={{ paintOrder: "stroke" }} />
        </svg>
      </div>
    </div>
  );
}
