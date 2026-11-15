import { useEffect, useLayoutEffect, useRef } from "react";
import { animate, useMotionTemplate, useMotionValue } from "motion/react";
import * as m from "motion/react-m";

const STRIP = "0\n1\n2\n3\n4\n5\n6\n7\n8\n9";
const DRAWN = "before:whitespace-pre before:content-[attr(data-text)]";
// the motion brief's (2026-11) springs: digit drums, and the two edges of a stretchy highlight
const drum = (index: number) => ({ type: "spring" as const, stiffness: 260, damping: 22 + 2 * index, delay: index * 0.045 });
const LEAD = { type: "spring" as const, stiffness: 620, damping: 36 };
const TRAIL = { type: "spring" as const, stiffness: 190, damping: 19 };

/** a number whose digits turn like wheels to their new value, keyed from the right, so only the ones that change move.
 * the text stays one plain node (what sizes it and what a screen reader hears); the wheels over it are drawn. */
export function Digits({ text, className }: { text: string; className?: string }) {
  const chars = [...text];
  let drums = 0;
  return (
    <span className={`relative inline-block whitespace-nowrap ${className ?? ""}`}>
      <span aria-hidden className="pointer-events-none absolute inset-0 flex leading-[inherit]">
        {chars.map((char, i) => {
          const key = chars.length - i;
          if (!/\d/.test(char)) return <span key={`c${key}${char}`} data-text={char} className={DRAWN} />;
          const index = drums++;
          return (
            <span key={`d${key}`} className="h-[1lh] overflow-clip [mask-image:linear-gradient(transparent,#000_12%,#000_88%,transparent)]">
              <m.span data-text={STRIP} className={`block text-center ${DRAWN}`} initial={false} animate={{ y: `${-Number(char)}lh` }} transition={drum(index)} />
            </span>
          );
        })}
      </span>
      <span className="text-transparent">{text}</span>
    </span>
  );
}

/** a segmented control's highlight that stretches to the picked option: the edge facing the move runs ahead, the other
 * catches up. drawn as a full-size layer of its group cut down with clip-path, so it stays one element. */
export function StretchPill({ target, className }: { target: string; className?: string }) {
  const pill = useRef<HTMLSpanElement>(null);
  const l = useMotionValue(0), r = useMotionValue(0), t = useMotionValue(0), b = useMotionValue(0);
  const clip = useMotionTemplate`inset(${t}px ${r}px ${b}px ${l}px round 999px)`;
  useEffect(() => clip.on("change", (value) => { if (pill.current) pill.current.style.clipPath = value; }), [clip]);
  const first = useRef(true);
  useLayoutEffect(() => {
    // the group it sits in: a parent's ref is not attached yet when a child's first layout effect runs
    const host = pill.current?.parentElement, el = host?.querySelector<HTMLElement>(`[data-stretch-key="${target}"]`);
    if (!host || !el || !pill.current) return;
    const W = host.clientWidth, H = host.clientHeight;
    const L = el.offsetLeft, R = W - el.offsetLeft - el.offsetWidth, T = el.offsetTop, B = H - el.offsetTop - el.offsetHeight;
    const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (first.current || still) {
      l.set(L); r.set(R); t.set(T); b.set(B);
      pill.current.style.clipPath = `inset(${T}px ${R}px ${B}px ${L}px round 999px)`;
      first.current = false;
      return;
    }
    const right = L > l.get();
    const moves = [animate(l, L, right ? TRAIL : LEAD), animate(r, R, right ? LEAD : TRAIL), animate(t, T, LEAD), animate(b, B, LEAD)];
    return () => moves.forEach((move) => move.stop());
  }, [target, l, r, t, b]);
  return <span ref={pill} aria-hidden className={`pointer-events-none absolute inset-0 ${className ?? "bg-pop"}`} style={{ clipPath: "inset(50%)" }} />;
}
