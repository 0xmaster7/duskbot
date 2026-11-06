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
  // grok's @ row: one 28px line, a 16px face, the name, then the grey kind at the end; a bot's title waits in grey
  // after its name, so two bots of one name still read apart
  return (
    <button
      type={type}
      {...rest}
      className={cn(
        "flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-start text-[13px] leading-[18px]",
        selected && "bg-menu-active",
        className,
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="max-w-full shrink-0 truncate text-ink">{name}</span>
        {description ? (
          <span dir="auto" className="min-w-0 truncate text-[color:var(--composer-muted)]">
            {description}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-end text-[color:var(--composer-muted)]">{kind}</span>
    </button>
  );
}
