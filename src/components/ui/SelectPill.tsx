import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";

/** Grok's ghost select in a settings row ("Liora", "1x", "Auto-detect"): a 24px hairline pill sized to its value, a native
 * select underneath so the keyboard and the platform list come for free. Its negative margins keep a 30px row 30px. */
export function SelectPill({ className, children, ...props }: Omit<ComponentProps<"select">, "size">) {
  return (
    <span className={cn("relative -my-[3px] -mr-[5px] inline-flex min-w-0 shrink-0", className)}>
      <select
        {...props}
        className={cn(
          "peer h-6 min-w-0 max-w-[160px] cursor-pointer appearance-none truncate rounded-lg border border-ink/[0.06] bg-transparent py-0.5 pl-1.5 pr-5 text-[13px] leading-[18px] tracking-[-0.08px] text-ink [field-sizing:content]",
          "[color-scheme:var(--code-color-scheme)] [&_option]:bg-menu [&_option]:text-ink",
          "transition-colors duration-100 hover:bg-ink/[0.06] active:bg-ink/[0.08]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          "disabled:cursor-default disabled:opacity-50",
        )}
      >
        {children}
      </select>
      <ChevronDown size={12} aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-ink-secondary peer-disabled:opacity-50" />
    </span>
  );
}
