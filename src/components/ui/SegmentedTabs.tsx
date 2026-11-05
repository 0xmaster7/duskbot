import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface SegmentedTab<V extends string> {
  value: V;
  label: ReactNode;
}

/** Grok's segmented tabs: 26px pills on the page, the chosen one filled at once (Grok draws no sliding fill). */
export function SegmentedTabs<V extends string>({ tabs, value, onChange, label, attr, className }: {
  tabs: readonly SegmentedTab<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  attr?: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

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
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("flex gap-0.5", className)}>
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
              "h-[26px] min-w-0 shrink truncate rounded-full px-2 py-1 text-[13px] leading-[18px] tracking-[0.015em]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              selected ? "bg-ink/[0.06] text-ink" : "text-ink-secondary hover:bg-ink/[0.06]",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
