import { useEffect, useId, useRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown, X } from "lucide-react";
import { cx } from "./kit";

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("switch-track relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full p-[3px] disabled:opacity-45", checked ? "bg-ink" : "bg-track")}
    >
      <span className={cx("switch-thumb size-5 rounded-full", checked ? "translate-x-[18px] bg-bg" : "translate-x-0 bg-ink-2")} aria-hidden />
    </button>
  );
}

/** a labelled range with its value on the right; no motion while dragging, it is hit dozens of times a second */
export function Slider({ label, value, min, max, step, onChange, format, hint }: { label: string; value: number; min: number; max: number; step: number; onChange(v: number): void; format(v: number): string; hint?: ReactNode }) {
  const id = useId();
  const fill = ((value - min) / Math.max(1, max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-14 text-ink-2">{label}</label>
        <span className="num text-14 font-medium text-ink">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="range mt-1.5"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--fill" as string]: `${fill}%` }}
      />
      <div className="flex justify-between text-12 text-ink-4" aria-hidden><span>{format(min)}</span>{hint && <span className="text-ink-3">{hint}</span>}<span>{format(max)}</span></div>
    </div>
  );
}

/** a two to four way choice with a thumb that slides between options; transitions retarget on rapid clicks */
export function Toggle<T extends string>({ value, options, onChange, label, className }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange(v: T): void; label: string; className?: string }) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className={cx("relative inline-grid shrink-0 rounded-full bg-card-2 p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className="seg-thumb absolute inset-y-1 left-1 rounded-full bg-track" style={{ width: `calc((100% - 8px) / ${options.length})`, transform: `translateX(${at * 100}%)` }} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("relative z-10 inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-13 transition-colors duration-150", value === o.value ? "text-ink" : "text-ink-3 hover-link")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string | null; hint?: ReactNode; children: ReactNode; htmlFor: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-13 text-ink-2">{label}</label>
      {children}
      {error ? <p id={`${htmlFor}-error`} role="alert" className="mt-2 text-13 text-bad">{error}</p> : hint ? <p className="mt-2 text-13 text-ink-4">{hint}</p> : null}
    </div>
  );
}

/** a centered dialog: scrim, escape and outside click close it, focus moves in and comes back */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (first ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea, a[href]")];
      if (!items.length) return;
      const [a, z] = [items[0]!, items[items.length - 1]!];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; back?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="fade-in absolute inset-0 backdrop-blur-[4px]" style={{ background: "var(--scrim)" }} onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx("modal-in relative w-full rounded-card bg-card p-6 outline-none max-sm:p-5", wide ? "max-w-[560px]" : "max-w-[440px]")} style={{ boxShadow: "var(--pop-shadow)" }}>
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-16 font-medium text-ink">{title}</h2>
          <button data-close type="button" onClick={onClose} aria-label="Close" className="press hover-ghost -me-2 -mt-2 grid size-10 shrink-0 place-items-center rounded-full text-ink-3"><X size={18} strokeWidth={1.5} /></button>
        </div>
        <div className="mt-2 text-14 leading-[1.55] text-ink-3">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** a status line with a dot; the colour always comes with words */
export function StatusDot({ tone, live, children, className }: { tone: "good" | "warn" | "bad" | "quiet" | "accent"; live?: boolean; children: ReactNode; className?: string }) {
  const color = { good: "text-good", warn: "text-warn", bad: "text-bad", quiet: "text-ink-4", accent: "text-accent" }[tone];
  return (
    <span className={cx("inline-flex items-center gap-2 text-13 text-ink-3", className)}>
      <span className={cx("live-dot", color)} data-live={live} aria-hidden />
      <span className="num">{children}</span>
    </span>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx("relative block", className)}>
      <select {...rest} className="field cursor-pointer appearance-none bg-card pe-10">{children}</select>
      <ChevronDown size={16} strokeWidth={1.5} className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
    </span>
  );
}
