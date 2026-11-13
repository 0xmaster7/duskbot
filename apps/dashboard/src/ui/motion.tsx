import { useId, useMemo, useRef, type ReactNode } from "react";
import { AnimatePresence, LazyMotion, MotionConfig, useReducedMotion, type Transition } from "motion/react";
import * as m from "motion/react-m";

/** quick and calm: settles in about a quarter second, no overshoot to speak of */
export const SPRING: Transition = { type: "spring", visualDuration: 0.26, bounce: 0.08 };
/** sheets, drawers and anything that travels further */
export const GLIDE: Transition = { type: "spring", visualDuration: 0.32, bounce: 0 };
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const FADE: Transition = { duration: 0.16, ease: EASE_OUT };

const features = () => import("./motion-features").then((mod) => mod.default);

/** every motion surface sits under this: features load lazily, and reduced motion keeps fades but drops movement */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={features} strict>
      <MotionConfig reducedMotion="user" transition={SPRING}>{children}</MotionConfig>
    </LazyMotion>
  );
}

/** the moving highlight of a segmented control, tab strip or nav: the selected option renders it, and it slides to the next one */
export function Pill({ id, className }: { id: string; className?: string }) {
  return <m.span layoutId={id} aria-hidden className={`absolute inset-0 rounded-full ${className ?? "bg-pop"}`} transition={SPRING} />;
}
/** one pill id per control instance, so two copies of the same control never trade highlights */
export const usePill = () => `pill${useId()}`;

/** a page's content arriving: a short rise and fade, no exit, so the next page never waits on the last one */
export function PageIn({ children, className, id }: { children: ReactNode; className?: string; id: string }) {
  return <m.div key={id} className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE_OUT }}>{children}</m.div>;
}

/** a popover or menu that scales from its trigger; the caller sets the transform origin */
export function Pop({ open, children, className, style, role = "menu" }: { open: boolean; children: ReactNode; className?: string; style?: React.CSSProperties; role?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <m.div role={role} className={className} style={style} initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12, ease: EASE_OUT } }} transition={{ type: "spring", visualDuration: 0.18, bounce: 0 }}>
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** the stack of short lines at the bottom: each rises in, the rest make room, and it fades out where it stands */
export function ToastStack({ items }: { items: Array<{ id: number; content: ReactNode; className?: string }> }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[max(20px,calc(env(safe-area-inset-bottom)+8px))] z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((t) => (
          <m.div key={t.id} layout className={t.className} style={{ boxShadow: "var(--pop-shadow)" }}
            initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: EASE_OUT } }}>
            {t.content}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** stable element keys for a list whose data swaps: a row whose key is still there keeps its element (and moves), a row
 * that left hands its element to a newcomer (which then morphs out of it), so only a change in length adds or removes rows */
export function useSlots(keys: readonly string[]): string[] {
  const held = useRef(new Map<string, string>());
  const counter = useRef(0);
  const signature = keys.join("\u0000");
  return useMemo(() => {
    const before = held.current, now = new Set(keys);
    const free = [...before].filter(([key]) => !now.has(key)).map(([, slot]) => slot);
    const next = new Map<string, string>();
    for (const key of keys) next.set(key, before.get(key) ?? free.shift() ?? `slot${counter.current++}`);
    held.current = next;
    return keys.map((key) => next.get(key)!);
  }, [signature]);
}

/** text that cross-fades when it changes, in place; for labels on rows that morph into other rows */
export function SwapText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`relative inline-grid ${className ?? ""}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span key={text} className="col-start-1 row-start-1 truncate" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: EASE_OUT }}>{text}</m.span>
      </AnimatePresence>
    </span>
  );
}

export { AnimatePresence, m, useReducedMotion };
