import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import { REDUCED } from "@/lib/motion-presets";
import { usePrefersReducedMotion } from "./mascot-clock";

/** A still mark (reduced motion) cannot morph from one state into the next, so it crossfades instead: the old pose fades
 * out over the new one. With motion on, the mark morphs by itself and this is just its child. */
export function MarkCrossfade({ swap, children }: { swap: string; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  if (!reduced) return children;
  return (
    <span className="inline-grid shrink-0" data-mark-crossfade="">
      <AnimatePresence initial={false}>
        <motion.span
          key={swap}
          className="inline-flex [grid-area:1/1]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={REDUCED}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
