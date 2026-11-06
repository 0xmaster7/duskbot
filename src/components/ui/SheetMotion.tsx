import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";

import { REDUCED, SCRIM, SHEET } from "@/lib/motion-presets";

/** The app's reduced-motion choice or the system's. */
export function useMotionReduced(): boolean {
  const system = useReducedMotion();
  return Boolean(system) || (typeof document !== "undefined" && document.documentElement?.dataset?.reducedMotion === "true");
}

const MOTION_PROPS = ["initial", "animate", "exit", "transition", "variants", "custom", "whileTap", "whileHover", "onAnimationComplete"] as const;

/** motion measures and listens on a real window; rendered to a string there is none, so the element draws at rest. */
const live = () => typeof window !== "undefined" && typeof window.addEventListener === "function";

function rest<P extends object>(props: P): P {
  const plain = { ...props } as Record<string, unknown>;
  for (const key of MOTION_PROPS) delete plain[key];
  return plain as P;
}

/** A motion div where there is a window to animate in, a plain div at rest elsewhere. */
export function MotionDiv(props: HTMLMotionProps<"div">) {
  return live() ? <motion.div {...props} /> : <div {...(rest(props) as React.HTMLAttributes<HTMLDivElement>)} />;
}

/** A motion span where there is a window to animate in, a plain span at rest elsewhere. */
export function MotionSpan(props: HTMLMotionProps<"span">) {
  return live() ? <motion.span {...props} /> : <span {...(rest(props) as React.HTMLAttributes<HTMLSpanElement>)} />;
}

const FADE = { initial: { opacity: 0 }, animate: { opacity: 1, transition: REDUCED }, exit: { opacity: 0, transition: REDUCED } };

/** A centered sheet's own box: bencho's modal entrance (and exit, under AnimatePresence); a fade alone when motion is reduced. */
export function SheetMotion(props: HTMLMotionProps<"div">) {
  const reduced = useMotionReduced();
  return <MotionDiv {...(reduced ? FADE : SHEET)} {...props} />;
}

/** The dimmed backdrop behind a sheet, fading in and out. */
export function ScrimMotion(props: HTMLMotionProps<"div">) {
  const reduced = useMotionReduced();
  return <MotionDiv {...(reduced ? FADE : SCRIM)} {...props} />;
}
