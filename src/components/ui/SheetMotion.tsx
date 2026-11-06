import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";


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


/** A centered sheet's own box. Dialogs open and close raw, in one frame, like the rest of the app's windows. */
export function SheetMotion(props: HTMLMotionProps<"div">) {
  return <MotionDiv initial={false} {...props} />;
}

/** The dimmed backdrop behind a sheet, there at once. */
export function ScrimMotion(props: HTMLMotionProps<"div">) {
  return <MotionDiv initial={false} {...props} />;
}
