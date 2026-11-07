import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useStore } from "../data/store";
import { Button, IconButton, Input, cx } from "./kit";
import { useReducedMotion } from "./Mascot";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** Focus moves in on open, Tab stays inside, Escape closes and focus returns to whatever opened it. */
function useTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => [...(node?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])];
    requestAnimationFrame(() => (node?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? node)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0]!, last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; before?.focus?.(); };
  }, [open]);
  return ref;
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useTrap(open, onClose);
  const reduced = useReducedMotion();
  const id = useId();
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-[#1c1c18]/20" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
            className="absolute inset-y-2 end-2 flex w-[min(460px,calc(100vw-16px))] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-pop outline-none"
            initial={reduced ? { opacity: 0 } : { transform: "translateX(104%)" }}
            animate={reduced ? { opacity: 1 } : { transform: "translateX(0%)" }}
            exit={reduced ? { opacity: 0 } : { transform: "translateX(104%)" }}
            transition={{ duration: reduced ? 0.15 : 0.42, ease: EASE_DRAWER }}>
            <div className="flex min-h-14 items-center gap-2 border-b border-row px-5">
              <h2 id={id} className="min-w-0 flex-1 truncate text-16 font-medium">{title}</h2>
              <IconButton label="Close" icon={X} onClick={onClose} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center gap-2 border-t border-row px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Dialog({ open, onClose, title, children, actions, tone }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode; tone?: "danger" }) {
  const ref = useTrap(open, onClose);
  const reduced = useReducedMotion();
  const id = useId();
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-6">
          <motion.div className="absolute inset-0 bg-[#1c1c18]/25" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
          <motion.div ref={ref} role={tone === "danger" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={id} tabIndex={-1}
            className="relative w-full max-w-[440px] rounded-card border border-line bg-surface p-5 shadow-pop outline-none"
            initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(12px) scale(0.97)" }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px) scale(0.98)" }}
            transition={reduced ? { duration: 0.12 } : { type: "spring", duration: 0.34, bounce: 0.12 }}>
            <h2 id={id} className="text-16 font-medium">{title}</h2>
            <div className="mt-2 text-14 text-ink-2">{children}</div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** A destructive action that names what goes and asks for a typed word first. */
export function ConfirmDialog({ open, onClose, title, word, consequences, keeps, action, onConfirm }: { open: boolean; onClose: () => void; title: string; word?: string; consequences: string[]; keeps?: string[]; action: string; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  const id = useId();
  useEffect(() => { if (!open) setTyped(""); }, [open]);
  const ok = !word || typed.trim().toLowerCase() === word.toLowerCase();
  return (
    <Dialog open={open} onClose={onClose} title={title} tone="danger"
      actions={<><Button onClick={onClose}>Keep it</Button><Button variant="primary" className="bg-bad hover:bg-[#b52f2f]" disabled={!ok} onClick={() => { onConfirm(); onClose(); }}>{action}</Button></>}>
      <p className="text-13 font-medium text-ink">This removes</p>
      <ul className="mt-1.5 list-disc space-y-1 ps-5 text-13">{consequences.map((c) => <li key={c}>{c}</li>)}</ul>
      {keeps && <><p className="mt-3 text-13 font-medium text-ink">This keeps</p><ul className="mt-1.5 list-disc space-y-1 ps-5 text-13">{keeps.map((c) => <li key={c}>{c}</li>)}</ul></>}
      {word && (
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={id} className="text-13 font-medium text-ink">Type <span className="font-mono">{word}</span> to confirm</label>
          <Input id={id} data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
      )}
    </Dialog>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useStore();
  const reduced = useReducedMotion();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(12px) scale(0.97)" }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px) scale(0.98)" }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="pointer-events-auto flex min-h-10 items-center gap-3 rounded-full bg-black py-1.5 pe-1.5 ps-4 text-13 text-[#fafafa] shadow-pop">
            <span>{t.text}</span>
            {t.undo && <button type="button" className="h-7 rounded-full px-2.5 font-medium text-accent-3 hover:bg-white/10" onClick={() => { t.undo?.(); dismiss(t.id); }}>Undo</button>}
            <button type="button" aria-label="Dismiss" className="inline-flex size-7 items-center justify-center rounded-full text-[#bdbdbd] hover:bg-white/10" onClick={() => dismiss(t.id)}><X size={14} strokeWidth={1.5} aria-hidden /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** A small menu anchored to its button; opens instantly, as menus are used often. */
export function Menu({ label, trigger, items, align = "end" }: { label: string; trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: Array<{ label: string; onSelect: () => void; tone?: "danger" }>; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); box.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const at = list.indexOf(document.activeElement as HTMLElement);
        list[(at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div role="menu" aria-label={label} className={cx("absolute top-full z-40 mt-1 min-w-44 rounded-[10px] border border-line bg-surface p-1 shadow-pop", align === "end" ? "end-0" : "start-0")}>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onSelect(); }}
              className={cx("flex h-8 w-full items-center rounded-[7px] px-2.5 text-start text-13 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none pointer-coarse:h-11", item.tone === "danger" ? "text-bad" : "text-ink")}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
