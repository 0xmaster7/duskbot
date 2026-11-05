import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { DURATION, EASE_OUT, REDUCED } from "@/lib/motion-presets";

/** A section's rows, folding shut and open under its header; while shutting it keeps the rows it last had.
 * `animate` off leaves them unwrapped. */
export function SectionRows({ open, animate, children }: { open: boolean; animate: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  if (!animate) return open ? <>{children}</> : null;
  const tween = { duration: DURATION.base, ease: EASE_OUT };
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="rows"
          data-sidebar-section-rows=""
          className="flex flex-col gap-1"
          initial={{ height: 0, opacity: 0, overflow: "hidden" }}
          animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
          exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          transition={{ height: reduce ? { duration: 0 } : tween, opacity: reduce ? REDUCED : tween }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
