import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { GrokIcon } from "../../GrokIcon";
import { SettingsGroup, SettingsRows, SIMPLE_BUTTONS } from "../../SettingsPrimitives";

const textCls = "text-[13px] leading-[18px] tracking-[-0.08px]";
const rowCls = "flex min-h-12 items-center gap-5 px-3.5 py-2.5";

/** A pane of the bot's settings sheet in the app Settings' look: groups 28px apart, its switches and 30px pills. */
export function SheetBody({ children }: { children: ReactNode }) {
  // an unavailable switch stays legible on white: Grok's off track is only ink/6
  return <div data-settings-look="simple" className={cn("flex flex-col gap-7 [&_[role=switch]:disabled]:opacity-70", SIMPLE_BUTTONS)}>{children}</div>;
}

/** A small label over one white card of rows. */
export function Group({ label, footnote, children, ...rest }: { label: string; footnote?: ReactNode; children: ReactNode; "data-sheet-group"?: string }) {
  return (
    <div {...rest} className="contents">
      <SettingsGroup label={label} footnote={footnote}>
        <SettingsRows>{children}</SettingsRows>
      </SettingsGroup>
    </div>
  );
}

type Tone = "warn" | "danger";
const toneCls = (tone?: Tone) => (tone === "danger" ? "text-danger" : tone === "warn" ? "text-warning" : "text-ink-secondary");

/** Grok's 48px row: the name over an optional short line, its control on the right. */
export function Row({ title, hint, tone, children, mono, ...rest }: {
  title: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  mono?: boolean;
  children?: ReactNode;
  "data-sheet-row"?: string;
}) {
  return (
    <div {...rest} className={rowCls}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span role={tone && !hint ? "alert" : undefined} className={cn(textCls, "[overflow-wrap:anywhere]", hint ? "text-ink" : tone ? toneCls(tone) : "text-ink", mono && "font-mono text-[12px]")}>{title}</span>
        {hint && <span role={tone ? "alert" : undefined} className={cn(textCls, toneCls(tone))}>{hint}</span>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** A row that opens something: the name, an optional value, a chevron. */
export function LinkRow({ title, value, open, onClick, ...rest }: {
  title: string;
  value?: ReactNode;
  /** a disclosure: the chevron turns down while open */
  open?: boolean;
  onClick: () => void;
  "data-sheet-row"?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-expanded={open}
      onClick={onClick}
      className={cn(rowCls, "w-full cursor-pointer text-left outline-none transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus")}
    >
      <span className={cn(textCls, "min-w-0 flex-1 text-ink")}>{title}</span>
      {value && <span className={cn(textCls, "min-w-0 shrink truncate text-ink-secondary")}>{value}</span>}
      <span aria-hidden="true" className={cn("flex shrink-0 text-ink/40 transition-transform duration-[120ms]", open && "rotate-90")}>
        <GrokIcon name="chevron-right" size={14} />
      </span>
    </button>
  );
}

/** A labelled field across the whole row: a text area or anything wider than a row's right side. */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 px-3.5 py-2.5">
      <span className="text-[12px] leading-4 tracking-[0.01em] text-ink-secondary">{label}</span>
      {children}
    </label>
  );
}

/** The 30px pill the app Settings uses in its rows. */
export function Pill({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" {...props} className={cn("ui-button", className)} />;
}

/** Grok's pill group for a few short choices in a row's right side ("Off", "Read", "Read & write"). */
export function Choices<V extends string | null>({ value, options, onChange, label }: {
  value: V;
  options: ReadonlyArray<readonly [V, string, string?]>;
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-0.5 rounded-full bg-ink/[0.04] p-0.5">
      {options.map(([option, text, hint]) => (
        <button
          key={text}
          type="button"
          title={hint}
          aria-pressed={value === option}
          onClick={() => value !== option && onChange(option)}
          className={cn(
            "h-6 cursor-pointer rounded-full px-2.5 text-[12px] leading-4 transition-[background-color,color] duration-[120ms] ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
            value === option ? "bg-menu text-ink shadow-[0_0_0_0.5px_color-mix(in_srgb,var(--color-ink)_12%,transparent)]" : "text-ink-secondary hover:text-ink",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
