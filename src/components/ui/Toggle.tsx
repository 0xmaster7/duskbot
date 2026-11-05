import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/** Grok's switch: a 32 by 20 track, a 16px knob on a 120ms ease transition, the switch blue when on. */
export function Toggle({ checked, className, ...props }: Omit<ComponentProps<"button">, "children" | "role" | "aria-checked"> & { checked: boolean }) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      data-ui-toggle=""
      className={cn(
        "relative inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-ink)_6%,transparent)] transition-[background-color] duration-[120ms] ease-[ease] motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-app",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-accent enabled:hover:brightness-95 [:root[data-skin=grok]_&]:bg-accent-border [:root[data-skin=grok]_&]:enabled:hover:bg-accent [:root[data-skin=grok]_&]:enabled:hover:brightness-100"
          : "bg-ink/[0.06] enabled:hover:bg-ink/[0.10]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-[0_1px_3px_0_rgb(28_28_28/0.12)] transition-transform duration-[120ms] ease-[ease] motion-reduce:transition-none",
          checked && "translate-x-3",
        )}
      />
    </button>
  );
}
