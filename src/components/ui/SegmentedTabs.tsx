import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";
import { SPRING_SNAP } from "@/lib/motion-presets";

export interface SegmentedTab<V extends string> {
  value: V;
  label: ReactNode;
}

/** Grok's segmented tabs: 26px pills on the page, one shared fill that springs to the chosen tab. */
export function SegmentedTabs<V extends string>({ tabs, value, onChange, label, attr, className }: {
  tabs: readonly SegmentedTab<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  attr?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [fill, setFill] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const chosen = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!chosen || chosen.offsetWidth === 0) return setFill(null);
      setFill((current) => (current?.x === chosen.offsetLeft && current.width === chosen.offsetWidth ? current : { x: chosen.offsetLeft, width: chosen.offsetWidth }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, tabs]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const edge = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (!step && edge < 0) return;
    event.preventDefault();
    const at = tabs.findIndex((tab) => tab.value === value);
    const next = edge >= 0 ? edge : (at + step + tabs.length) % tabs.length;
    onChange(tabs[next]!.value);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("relative isolate flex gap-0.5", className)}>
      {fill && (
        <motion.span
          aria-hidden="true"
          data-tab-fill=""
          initial={false}
          animate={{ x: fill.x, width: fill.width }}
          transition={reduced ? { duration: 0 } : SPRING_SNAP}
          className="pointer-events-none absolute left-0 top-0 -z-10 h-[26px] rounded-full bg-ink/[0.06]"
        />
      )}
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            {...(attr ? { [attr]: tab.value } : {})}
            onClick={() => onChange(tab.value)}
            className={cn(
              "h-[26px] min-w-0 shrink truncate rounded-full px-2 py-1 text-[13px] leading-[18px] tracking-[0.015em] transition-colors duration-[120ms] ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              selected ? "text-ink" : "text-ink-secondary hover:bg-ink/[0.06]",
              selected && !fill && "bg-ink/[0.06]",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
