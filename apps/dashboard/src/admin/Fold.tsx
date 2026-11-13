import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "@/icons";
import { cx } from "../ui/kit";
import { AnimatePresence, m } from "../ui/motion";

const SPRING = { type: "spring", visualDuration: 0.24, bounce: 0 } as const;

export function Chevron({ open }: { open: boolean }) {
  return <m.span aria-hidden className="inline-flex shrink-0 text-ink-3" initial={false} animate={{ rotate: open ? 180 : 0 }} transition={SPRING}><ChevronDown size={14} strokeWidth={1.75} /></m.span>;
}

/** content that opens and closes by height, retargeting smoothly if toggled mid-flight */
export function Reveal({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div key="reveal" id={id} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING}>
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** a whole section kept closed until asked for: a title row that toggles, the content mounted only while open.
 * plain drops the card around the content, for content that is already cards */
export function Fold({ id, title, meta, defaultOpen = false, plain, children, className }: { id?: string; title: string; meta?: ReactNode; defaultOpen?: boolean; plain?: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const panel = useId();
  return (
    <section id={id} aria-labelledby={`${panel}h`} className={cx("scroll-mt-6", !plain && "rounded-[24px] bg-card p-2", className)}>
      <h2 id={`${panel}h`} className={cx("text-14 font-medium text-ink", plain && "rounded-[24px] bg-card p-2")}>
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)}
          className="hover-ghost flex min-h-11 w-full items-center justify-between gap-3 rounded-[16px] px-2 text-start">
          <span className="truncate">{title}</span>
          <span className="flex min-w-0 items-center gap-2">{meta && <span className="t-meta truncate max-sm:hidden">{meta}</span>}<Chevron open={open} /></span>
        </button>
      </h2>
      <Reveal open={open} id={panel}><div className={plain ? "pt-4" : "pt-1.5"}>{children}</div></Reveal>
    </section>
  );
}
