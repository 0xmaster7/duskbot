import { useEffect, useRef, useState } from "react";
import { WindowDragStrip } from "./DesktopCapabilities";

type Phase = "loading" | "closing" | "fading" | "gone";
const FADE_MS = 300;

/** Covers the window while it first connects: the ring creeps on its own, never past 90%, then closes the circle once
 * the app has something to show and fades away over it. A window that opens with its bots already there never shows it. */
export function BootCover({ busy, text }: { busy: boolean; text: string }) {
  const [phase, setPhase] = useState<Phase>(busy ? "loading" : "gone");
  const arc = useRef<SVGCircleElement>(null);
  const shown = useRef(0);
  const since = useRef(performance.now());

  useEffect(() => {
    if (busy || phase !== "loading") return;
    setPhase(matchMedia("(prefers-reduced-motion: reduce)").matches ? "gone" : "closing");
  }, [busy, phase]);

  useEffect(() => {
    if (phase !== "fading") return;
    const done = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(done);
  }, [phase]);

  useEffect(() => {
    if (phase !== "loading" && phase !== "closing") return;
    let frame = 0, settle = 0;
    const step = (now: number) => {
      if (phase === "closing") shown.current += (1 - shown.current) * 0.16;
      else shown.current += Math.max(0, 0.9 * (1 - Math.exp(-(now - since.current) / 2400)) - shown.current) * 0.08;
      const closed = phase === "closing" && 1 - shown.current < 0.004;
      if (closed) shown.current = 1;
      arc.current?.style.setProperty("stroke-dashoffset", String(100 - shown.current * 100));
      if (closed) settle = window.setTimeout(() => setPhase("fading"), 140);
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); clearTimeout(settle); };
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div data-boot-cover={phase} aria-hidden={phase !== "loading" || undefined}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-app transition-opacity ease-out data-[boot-cover=fading]:pointer-events-none data-[boot-cover=fading]:opacity-0 motion-reduce:transition-none"
      style={{ transitionDuration: `${FADE_MS}ms` }}>
      <WindowDragStrip />
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className="-rotate-90">
        <circle cx="28" cy="28" r="26" fill="none" strokeWidth="2.5" className="stroke-ink/[0.08]" />
        <circle ref={arc} cx="28" cy="28" r="26" fill="none" strokeWidth="2.5" strokeLinecap="round" pathLength={100}
          strokeDasharray="100" strokeDashoffset="100" className="stroke-ink" />
        <circle cx="28" cy="28" r="4.5" className="fill-ink" />
      </svg>
      <p role="status" className="text-[14px] font-medium leading-5 text-ink">{text}</p>
    </div>
  );
}
