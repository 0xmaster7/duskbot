import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

/** A pick-one of two to four short choices, all visible at once: a soft track and the chosen one lifted onto the card. */
export function Segmented<V extends string>({ value, options, onChange, disabled, className, "aria-label": label, ...rest }: {
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  className?: string;
  "aria-label": string;
  "data-settings-select"?: string;
  "data-panel-select"?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter((option) => !option.disabled);
  const move = (event: KeyboardEvent, by: number) => {
    event.preventDefault();
    const at = enabled.findIndex((option) => option.value === value);
    const next = enabled[(at + by + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
  return (
    <div
      {...rest}
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-segmented=""
      onKeyDown={(event) => {
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, rtl && event.key === "ArrowRight" ? -1 : 1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, rtl && event.key === "ArrowLeft" ? 1 : -1);
      }}
      className={cn("inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full bg-ink/[0.06] p-0.5", disabled && "opacity-50", className)}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={option.value}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => !checked && onChange(option.value)}
            className={cn(
              "h-6 min-w-0 cursor-pointer whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-medium leading-6 text-ink-secondary",
              "transition-[background-color,color,box-shadow,scale] duration-[120ms] ease-[ease] enabled:hover:text-ink",
              "outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus",
              "disabled:cursor-default enabled:active:scale-[0.97] motion-reduce:enabled:active:scale-100",
              checked && "bg-menu text-ink shadow-[0_1px_2px_rgb(28_28_28/0.08),0_0_0_0.5px_rgb(28_28_28/0.04)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
