import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Trash2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import type { MausColor } from "@/lib/mascot";
import { rowCls, RowText, SwitchRow as ListSwitchRow } from "../ListRows";
import { Toggle } from "../ui/Toggle";

export {
  Card, CardLabel, ItemRow, LabelAction, NavRow, NoteRow, PanelEmpty, PanelSections, RowIcon, RowText, roundButtonCls, rowCls, sectionGapCls,
} from "../ListRows";

export const buttonCls =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[9px] bg-control px-3.5 text-[13px] font-medium text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50";
export const chipCls = (on: boolean) =>
  cn(
    "rounded-full px-2.5 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    on ? "bg-ink/[0.15] text-ink" : "bg-ink/[0.04] text-ink-secondary enabled:hover:text-ink",
  );

/** Grok's per-hue switch colours (`bg/<hue>-primary`, `-primary-hover`); a colour Grok has no hue for keeps the accent. */
const SWITCH_TONE: Partial<Record<MausColor, { on: string; hover: string }>> = {
  green: { on: "#10ab61", hover: "#0d9655" },
  blue: { on: "#1680f3", hover: "#126fd4" },
  red: { on: "#e72e3b", hover: "#c82532" },
  coral: { on: "#e72e3b", hover: "#c82532" },
  orange: { on: "#ee620d", hover: "#d2550a" },
  purple: { on: "#8351e4", hover: "#7442d1" },
  cyan: { on: "#10a693", hover: "#0d9381" },
  teal: { on: "#10a693", hover: "#0d9381" },
  pink: { on: "#e52f8b", hover: "#c82779" },
  yellow: { on: "#da830e", hover: "#c2730b" },
  ["brown" as MausColor]: { on: "#9d6937", hover: "#86592e" },
};

export function BotSwitch({ color, ...props }: Parameters<typeof Toggle>[0] & { color: MausColor }) {
  return <Toggle {...props} tone={SWITCH_TONE[color]} />;
}

export function SwitchRow({ color, ...props }: Omit<Parameters<typeof ListSwitchRow>[0], "tone"> & { color: MausColor }) {
  return <ListSwitchRow {...props} tone={SWITCH_TONE[color]} />;
}

export function ColRow({ children, ...rest }: { children: ReactNode; "data-panel-row"?: string }) {
  return <div {...rest} className={cn(rowCls, "flex-col items-stretch gap-[9px]")}>{children}</div>;
}

export function LinkRow({ children, onClick, icon: Icon = ChevronRight, ...rest }: {
  children: ReactNode;
  onClick: () => void;
  icon?: LucideIcon;
  "data-panel-link"?: string;
}) {
  return (
    <button type="button" {...rest} onClick={onClick} className="flex min-h-[30px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink-secondary hover:bg-ink/[0.06] hover:text-ink">
      <span className="min-w-0 flex-1">{children}</span>
      <Icon size={14} className="shrink-0" aria-hidden="true" />
    </button>
  );
}

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  tooltip?: string;
}

export function Segmented<V extends string>({ options, value, onChange, label, attr, compact = false }: {
  options: readonly SegmentOption<V>[];
  value: string | null | undefined;
  onChange: (value: V) => void;
  label: string;
  attr: string;
  /** Grok's tab pills instead of a filled track: 26px, the chosen one on a 6% ink wash. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div role="group" aria-label={label} className="flex min-w-0 gap-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            {...{ [attr]: option.value }}
            aria-pressed={value === option.value}
            disabled={option.disabled}
            title={option.tooltip}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-[26px] min-w-0 shrink truncate rounded-full px-2 py-1 text-[13px] leading-[18px] tracking-[0.015em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
              value === option.value ? "bg-ink/[0.06] text-ink" : "text-ink-secondary enabled:cursor-pointer enabled:hover:bg-ink/[0.06]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="group" aria-label={label} className="flex w-full rounded-full bg-ink/[0.05] p-[3px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          {...{ [attr]: option.value }}
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.tooltip}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-w-0 flex-auto truncate whitespace-nowrap rounded-full px-1.5 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            value === option.value ? "bg-ink/[0.14] text-ink" : "text-ink-secondary enabled:hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedRow<V extends string>({ title, hint, footer, ...segmented }: Parameters<typeof Segmented<V>>[0] & {
  title?: ReactNode;
  hint?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <ColRow data-panel-row={segmented.attr}>
      {(title || hint) && <RowText title={title} hint={hint} />}
      <Segmented {...segmented} />
      {footer}
    </ColRow>
  );
}

export function TrashButton({ label, onClick, disabled, ...rest }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  "data-panel-action"?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-tertiary hover:bg-ink/[0.05] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Trash2 size={14} aria-hidden="true" />
    </button>
  );
}

export function RadioRow({ title, hint, checked, onClick, disabled, ...rest }: {
  title: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  "data-panel-choice"?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(rowCls, "w-full text-left enabled:hover:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-50")}
    >
      <RowText title={title} hint={hint} />
      <span className="flex w-4 shrink-0 text-ink">{checked && <Check size={16} aria-hidden="true" />}</span>
    </button>
  );
}

export function TextRow({ value, placeholder, label, action, disabled, onChange, onSubmit, ...rest }: {
  value: string;
  placeholder: string;
  label: string;
  action: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  "data-panel-form"?: string;
}) {
  return (
    <form
      {...rest}
      className={rowCls}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() && !disabled) onSubmit();
      }}
    >
      <input
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 flex-1 rounded-lg border border-hairline bg-inset px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent-border disabled:opacity-50"
      />
      <button type="submit" disabled={disabled || !value.trim()} className={buttonCls}>{action}</button>
    </form>
  );
}

export function PageHeader({ back, title, intro, onBack }: { back: string; title: string; intro?: ReactNode; onBack: () => void }) {
  return (
    <div>
      <button
        type="button"
        data-panel-back
        onClick={onBack}
        className="mt-0.5 inline-flex items-center gap-0.5 rounded-[7px] py-1 pl-0.5 pr-2 text-[13px] text-ink-secondary hover:bg-ink/[0.04] hover:text-ink"
      >
        <ChevronLeft size={15} aria-hidden="true" />
        <span>{back}</span>
      </button>
      <h3 className="mx-1 mt-1.5 text-[18px] font-semibold text-ink">{title}</h3>
      {intro && <p className="mx-1 mt-1.5 text-[13px] leading-normal text-ink-secondary">{intro}</p>}
    </div>
  );
}
