import type { ReactNode } from "react";
import cat from "../art/cat.webp";
import computer from "../art/s-computer.webp";
import notebook from "../art/s-notebook.webp";
import phone from "../art/s-phone.webp";
import { cx } from "./kit";

const ART = {
  cat: { src: cat, w: 132, h: 71 },
  computer: { src: computer, w: 104, h: 120 },
  notebook: { src: notebook, w: 132, h: 96 },
  phone: { src: phone, w: 128, h: 95 },
} as const;

/** an empty state: one small piece of pixel art, a line, and the next step; no box around it */
export function SkyEmpty({ title, children, action, className, art = "computer" }: { title: string; children?: ReactNode; action?: ReactNode; className?: string; art?: keyof typeof ART }) {
  const a = ART[art];
  return (
    <div className={cx("enter px-6 py-14 text-center", className)}>
      <div className="flex flex-col items-center">
        <img src={a.src} alt="" width={a.w} height={a.h} className="-rotate-3" draggable={false} />
        <h2 className="mt-6 text-20 font-medium tracking-[-0.03em] text-ink">{title}</h2>
        {children && <div className="mt-1.5 max-w-[44ch] text-14 leading-[1.55] text-ink-3">{children}</div>}
        {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
