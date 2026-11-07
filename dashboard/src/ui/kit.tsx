import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Ban, type LucideIcon } from "lucide-react";
import type { Coverage, TurnStatus } from "../data/types";
import { Link } from "../lib/router";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
export const STROKE = 1.5;

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
const VARIANT: Record<Variant, string> = {
  primary: "bg-black text-[#fafafa] hover:bg-[#333] disabled:bg-ink-4",
  accent: "bg-accent text-[#fafafa] hover:bg-accent-hover disabled:bg-accent-3",
  secondary: "border border-line bg-surface text-ink hover:bg-hover disabled:text-ink-4",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink disabled:text-ink-4",
  danger: "border border-[#f1d2d2] bg-surface text-bad hover:bg-bad-wash disabled:text-ink-4",
};

const buttonBase =
  "inline-flex h-8 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-13 font-medium transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] disabled:active:scale-100 pointer-coarse:h-11 pointer-coarse:px-4";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon; size?: "sm" | "md" }>(
  ({ variant = "secondary", icon: Icon, size = "md", className, children, type = "button", ...rest }, ref) => (
    <button ref={ref} type={type} className={cx(buttonBase, VARIANT[variant], size === "sm" && "h-7 px-2.5 text-12", className)} {...rest}>
      {Icon && <Icon size={14} strokeWidth={STROKE} aria-hidden />}
      {children}
    </button>
  ),
);

export function ButtonLink({ to, variant = "secondary", icon: Icon, children, className, external }: { to: string; variant?: Variant; icon?: LucideIcon; children: ReactNode; className?: string; external?: boolean }) {
  const cls = cx(buttonBase, VARIANT[variant], className);
  const inner = <>{Icon && <Icon size={14} strokeWidth={STROKE} aria-hidden />}{children}</>;
  return external ? <a href={to} className={cls}>{inner}</a> : <Link to={to} className={cls}>{inner}</Link>;
}

export function IconButton({ label, icon: Icon, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-ink active:scale-[0.94] pointer-coarse:size-11", className)} {...rest}>
      <Icon size={16} strokeWidth={STROKE} aria-hidden />
    </button>
  );
}

export function Card({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article"; "aria-labelledby"?: string; id?: string }) {
  return <Tag className={cx("rounded-card border border-line bg-surface shadow-card", className)} {...rest}>{children}</Tag>;
}

export function CardHead({ icon: Icon, title, id, children, className }: { icon?: LucideIcon; title: ReactNode; id?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex min-h-12 items-center gap-2 px-4 pt-3", className)}>
      {Icon && <Icon size={16} strokeWidth={STROKE} className="text-ink-3" aria-hidden />}
      <h2 id={id} className="text-13 font-medium text-ink">{title}</h2>
      <div className="ms-auto flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-3 pb-6">
      <div className="min-w-0 flex-1">
        <h1 className="text-24 font-semibold tracking-[-0.4px] text-ink">{title}</h1>
        {sub && <p className="mt-1 text-14 text-ink-3">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function SubHead({ title, id, children }: { title: string; id?: string; children?: ReactNode }) {
  return (
    <div className="mb-3 mt-10 flex items-center gap-3 first:mt-0">
      <h2 id={id} className="text-16 font-medium text-ink">{title}</h2>
      <div className="ms-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "outline";
const TONE: Record<Tone, string> = {
  neutral: "bg-track text-ink-2",
  accent: "bg-accent-wash text-accent-ink",
  good: "bg-good-wash text-good",
  warn: "bg-warn-wash text-warn",
  bad: "bg-bad-wash text-bad",
  outline: "border border-line text-ink-3",
};

export function Pill({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 text-12 font-medium", TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const coverageLabel: Record<Coverage, string> = { included: "Included", paid: "Paid", own: "Your own", trial: "Trial" };

export function CoverageTag({ coverage, className }: { coverage: Coverage; className?: string }) {
  if (coverage === "own") return <span title="Runs on your own subscription. Never billed by us." className={cx("inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-chip border border-dashed border-[#cfcfcf] px-1.5 text-12 font-medium text-ink-3", className)}>Your own</span>;
  if (coverage === "trial") return <Pill tone="outline" className={cx("border-accent-3 text-accent-ink", className)}>Trial</Pill>;
  return <Pill tone={coverage === "included" ? "accent" : "neutral"} className={cx(coverage === "paid" && "bg-ink text-[#fafafa]", className)}>{coverageLabel[coverage]}</Pill>;
}

export function StatusTag({ status }: { status: TurnStatus }) {
  if (status === "ok") return null;
  return <Pill tone="outline" className="text-ink-3"><Ban size={11} strokeWidth={2} aria-hidden />Not charged</Pill>;
}

/** Rico's 11-tick bar for any score, health or allowance. */
export function Ticks({ value, max = 100, size = "sm", label, tone, animate = true }: { value: number; max?: number; size?: "sm" | "lg"; label: string; tone?: "auto" | "accent" | "ink"; animate?: boolean }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const on = ratio === 0 ? 0 : Math.max(1, Math.round(ratio * 11));
  const auto = (tone ?? "auto") === "auto";
  const fill = auto && ratio >= 1 ? "bg-bad" : auto && ratio >= 0.9 ? "bg-[#d99a1c]" : tone === "ink" ? "bg-ink" : "bg-accent";
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100}
      className={cx("flex shrink-0 items-end", size === "sm" ? "h-2 w-[53px] gap-[2px]" : "h-2.5 w-full gap-[3px]")}>
      {Array.from({ length: 11 }, (_, i) => (
        <span key={i} style={animate && i < on ? { animationDelay: `${i * 22}ms` } : undefined}
          className={cx("h-full rounded-[1.5px]", size === "sm" ? "w-[3px]" : "flex-1 rounded-[2px]", i < on ? cx(fill, animate && "tick-in") : "bg-track")} />
      ))}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-[14px] w-6 shrink-0 items-center rounded-full transition-colors duration-200 ease-out after:absolute after:-inset-3 after:content-[''] disabled:opacity-50", checked ? "bg-accent" : "bg-[#d4d4d2]")}>
      <span aria-hidden className={cx("size-[10px] rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-out", checked ? "translate-x-3" : "translate-x-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-[9px] bg-track p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cx("rounded-[7px] px-2.5 font-medium transition-[background-color,color,box-shadow] duration-150 ease-out pointer-coarse:min-h-10",
            size === "sm" ? "h-6 text-12" : "h-7 text-13",
            o.value === value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-ink-3 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describe = error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-13 font-medium text-ink">{label}</label>
      {children(fieldId, describe)}
      {error ? <p id={`${fieldId}-err`} className="text-12 text-bad">{error}</p> : hint ? <p id={`${fieldId}-hint`} className="text-12 text-ink-3">{hint}</p> : null}
    </div>
  );
}

const control = "h-8 w-full min-w-0 rounded-[8px] border border-line bg-surface px-2.5 text-14 text-ink placeholder:text-ink-4 transition-[border-color,box-shadow] duration-150 hover:border-[#dcdcd9] focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--color-accent-4)] focus-visible:outline-none disabled:bg-sunk disabled:text-ink-4 aria-[invalid=true]:border-bad pointer-coarse:h-11";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => <input ref={ref} className={cx(control, className)} {...rest} />);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(control, "cursor-pointer appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23737373' stroke-width='1.4'/%3E%3C/svg%3E\")] bg-[right_10px_center] bg-no-repeat pe-7", className)} {...rest}>
      {children}
    </select>
  );
}

/** A compact filter select: label is visible, so it doubles as the control's name. */
export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  const id = useId();
  return (
    <div className="flex h-7 items-center rounded-chip border border-line bg-surface ps-2 text-13 pointer-coarse:h-11">
      <label htmlFor={id} className="whitespace-nowrap font-medium text-ink-3">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none rounded-chip bg-transparent pe-2 ps-1.5 font-medium text-ink focus-visible:outline-offset-0">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function StatusDot({ tone, pulse }: { tone: "good" | "warn" | "bad" | "idle" | "accent"; pulse?: boolean }) {
  const color = { good: "bg-good", warn: "bg-[#d99a1c]", bad: "bg-bad", idle: "bg-ink-4", accent: "bg-accent" }[tone];
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden>
      {pulse && <span className={cx("absolute inset-0 rounded-full opacity-40 motion-safe:animate-ping", color)} />}
      <span className={cx("relative size-2 rounded-full", color)} />
    </span>
  );
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-b border-row py-2 last:border-b-0">
      <dt className="text-13 text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-end text-13 font-medium text-ink">{children}</dd>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-line bg-surface px-1 font-sans text-12 text-ink-3">{children}</kbd>;
}
