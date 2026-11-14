import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SlidingPill<V extends string> {
  value: V;
  label: ReactNode;
  title?: string;
  /** Extra attributes for the option's button, e.g. a data hook. */
  attrs?: HTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;
}

/** A menu's pick-one of equal pills on an ink-tinted track: the fill is one thumb that slides to the picked pill on the
 * app's spring (a transition, so a quick second pick retargets from wherever it is), the words crossfade their ink, and
 * a press barely gives. Nothing picked leaves the thumb faded out. Reduced motion: the thumb jumps, the ink still fades.
 * (ui/Segmented is the settings pages' version: a lifted card on a soft track, sized to its labels.) */
export function SlidingPills<V extends string>({ options, value, onPick, className, pillClassName = "px-2", ...rest }: {
  options: readonly SlidingPill<V>[];
  value: V | undefined;
  onPick: (value: V) => void;
  className?: string;
  /** The pills' side padding: narrower where more of them share the track. */
  pillClassName?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onChange">) {
  const at = options.findIndex((option) => option.value === value);
  const tabStop = Math.max(0, at);
  return (
    <div role="group" {...rest} className={cn("relative isolate m-1 grid rounded-full bg-ink/[0.05] p-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden="true"
        data-segmented-pill=""
        className="sliding-pill-thumb pointer-events-none absolute inset-y-[3px] start-[3px] -z-10 rounded-full bg-ink/[0.1]"
        style={{ width: `calc((100% - 6px) / ${options.length})`, "--pill-at": Math.max(0, at), opacity: at < 0 ? 0 : 1 } as CSSProperties}
      />
      {options.map((option, index) => {
        const picked = index === at;
        return (
          <button
            key={option.value}
            type="button"
            {...option.attrs}
            aria-pressed={picked}
            tabIndex={index === tabStop ? 0 : -1}
            title={option.title}
            onClick={() => onPick(option.value)}
            className={cn(
              "dusk-press-soft h-6 min-w-0 truncate rounded-full text-[12px] leading-4 touch:h-8", pillClassName,
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
              picked ? "text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
