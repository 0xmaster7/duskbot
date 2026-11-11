import { useEffect, useRef, useState, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { cx } from "./kit";

/** a calm table: no card, quiet grey headers, 14px rows at least 48px tall, hairlines between */
export function Table({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={cx("min-w-0 overflow-x-auto", className)}>
      <table aria-label={label} className="w-full border-collapse text-start text-14">{children}</table>
    </div>
  );
}

export function Th({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cx("t-meta h-10 whitespace-nowrap border-b border-line px-4 text-start font-normal lowercase first:ps-0", className)} {...rest}>{children}</th>;
}

export function Td({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx("h-14 border-b border-line px-4 py-2 align-middle text-ink first:ps-0", className)} {...rest}>{children}</td>;
}

/** a dash for a value we do not know */
export const Nil = () => <span className="text-ink-4" aria-label="None">-</span>;

export function SectionHead({ id, children, action, className }: { id?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-3 flex min-h-10 flex-wrap items-center justify-between gap-3", className)}>
      <h2 id={id} className="text-16 font-medium tracking-[-0.02em] text-ink">{children}</h2>
      {action}
    </div>
  );
}

export interface MenuItem { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; checked?: boolean }

/** the "..." button and its menu; it opens from the button's corner and closes on escape or outside press */
export function RowMenu({ label, items, align = "end", icon, active }: { label: string; items: MenuItem[]; align?: "start" | "end"; icon?: ReactNode; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled)")?.focus();
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); button.current?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const all = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? [])];
      const at = all.indexOf(document.activeElement as HTMLElement);
      all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex">
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cx("hover-ghost grid size-9 shrink-0 place-items-center rounded-full max-sm:size-11", open || active ? "bg-card-2 text-ink" : "text-ink-3")}>
        {icon ?? <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />}
      </button>
      {open && (
        <div role="menu" className={cx("pop menu-in absolute top-full z-30 mt-1 min-w-[200px] rounded-[16px] bg-pop p-1.5", align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left")} style={{ boxShadow: "var(--pop-shadow)" }}>
          {items.map((item) => (
            <button key={item.label} type="button" role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }} className={cx("hover-ghost flex h-9 w-full items-center justify-between gap-3 rounded-[10px] px-2.5 text-start text-13 outline-none focus-visible:bg-card-2 disabled:opacity-45", item.danger ? "text-bad" : "text-ink-2")}>
              <span className="truncate">{item.label}</span>
              {item.checked && <Check size={15} strokeWidth={1.75} className="shrink-0 text-ink-2" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** a small status dot after a name; the words go to screen readers and, when it needs attention, on screen too */
export function NameDot({ tone, label }: { tone: "good" | "warn" | "quiet"; label: string }) {
  return <span className={cx("inline-block size-[7px] shrink-0 rounded-[2px]", tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : "bg-ink-4")} role="img" aria-label={label} title={label} />;
}
