import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

/** A pick-one of two to four short choices, all visible at once: a soft track and the chosen one lifted onto the card
 * (white in a light skin, a lighter tone of ink in a dark one: see .segmented-fill).
 * The lifted card is one pill that slides to the chosen option (240ms on the web's ease-out, as the dashboard's does);
 * a transition, so a quick second pick retargets from wherever it is. Reduced motion drops the slide. */
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
  const [pill, setPill] = useState<{ x: number; y: number; width: number; height: number; moved: boolean } | null>(null);
  useLayoutEffect(() => {
    const root = group.current;
    if (!root) return;
    const place = () => {
      const chosen = root.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
      if (!chosen || !chosen.offsetWidth) return setPill(null);
      const next = { x: chosen.offsetLeft, y: chosen.offsetTop, width: chosen.offsetWidth, height: chosen.offsetHeight };
      // the first placement lands without a slide; only a later move animates
      setPill((last) => last && last.x === next.x && last.y === next.y && last.width === next.width && last.height === next.height ? last : { ...next, moved: last !== null });
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(place);
    watch.observe(root);
    return () => watch.disconnect();
  }, [value, options.length]);
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
      className={cn("relative isolate inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full bg-ink/[0.06] p-0.5", disabled && "opacity-50", className)}
    >
      {pill && (
        <span
          aria-hidden="true"
          data-segmented-pill=""
          style={{ width: pill.width, height: pill.height, transform: `translate3d(${pill.x}px, ${pill.y}px, 0)` }}
          className={cn(
            "pointer-events-none absolute left-0 top-0 -z-10 rounded-full segmented-fill",
            pill.moved && "[transition:transform_240ms_var(--dusk-ease-out),width_240ms_var(--dusk-ease-out)] motion-reduce:transition-none",
          )}
        />
      )}
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
              "h-6 min-w-0 cursor-pointer whitespace-nowrap rounded-full px-2.5 text-[13px] leading-6 text-ink-secondary",
              "transition-[background-color,color,box-shadow,scale] duration-[120ms] ease-[ease] enabled:hover:text-ink",
              "outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus",
              "disabled:cursor-default enabled:active:scale-[0.97] motion-reduce:enabled:active:scale-100",
              checked && "text-ink",
              checked && !pill && "segmented-fill",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
