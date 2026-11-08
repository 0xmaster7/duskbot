import type { ReactNode } from "react";
import { Mascot } from "./Mascot";
import { cx } from "./kit";

/** an empty state: one mascot, a line, and the next step; no box around it */
export function SkyEmpty({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("border-y border-line px-6 py-14 text-center", className)}>
      <div className="flex flex-col items-center">
        <Mascot color="blue" size={44} state="curious" />
        <h2 className="mt-4 text-16 font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {children && <div className="mt-1 max-w-[46ch] text-14 leading-[1.55] text-ink-3">{children}</div>}
        {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
