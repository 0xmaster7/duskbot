import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function ComposerMenuRow({
  icon,
  name,
  description,
  kind,
  selected = false,
  className,
  type = "button",
  ...rest
}: {
  icon: ReactNode;
  name: string;
  description?: string;
  kind: string;
  selected?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...rest}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-start",
        selected && "bg-menu-hover",
        className,
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 tracking-[0.01em] text-ink">{name}</span>
        {description ? (
          <span dir="auto" className="block truncate text-[12px] leading-4 text-ink-tertiary">
            {description}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-end text-[12px] text-ink-tertiary">{kind}</span>
    </button>
  );
}
