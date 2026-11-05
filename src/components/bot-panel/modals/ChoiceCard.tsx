import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { GrokIcon, type GrokIconName } from "../../GrokIcon";
import { rowHintCls, rowTitleCls } from "./ModalSheet";

/** One choice of several as a card: an icon tile, the name and a line under it, and Grok's chosen ring (the ink edge
 * the Create New Bot tiles use) with a check. Arrow keys move between the cards of one radiogroup. */
export function ChoiceCard({ icon, title, hint, checked, disabled, onSelect, children, ...rest }: {
  icon: GrokIconName;
  title: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children?: ReactNode;
  "data-panel-choice"?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border transition-[border-color,background-color,box-shadow] duration-[120ms] ease-[ease]",
        checked ? "border-ink/80 shadow-[0_0_0_0.5px_color-mix(in_srgb,var(--color-ink)_80%,transparent)]" : "border-ink/12",
        !checked && !disabled && "hover:border-ink/24 hover:bg-ink/[0.02]",
      )}
    >
      <button
        type="button"
        role="radio"
        {...rest}
        aria-checked={checked}
        disabled={disabled}
        tabIndex={checked ? 0 : -1}
        onClick={onSelect}
        onKeyDown={(event) => {
          const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
          if (!keys.includes(event.key)) return;
          const group = event.currentTarget.closest('[role="radiogroup"]');
          const radios = [...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [])];
          const at = radios.indexOf(event.currentTarget);
          if (at < 0) return;
          event.preventDefault();
          const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
          const next = radios[(at + step + radios.length) % radios.length];
          next?.focus();
          next?.click();
        }}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[11px] p-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-[9px] transition-colors duration-[120ms]", checked ? "bg-ink text-app" : "bg-ink/[0.05] text-ink/80")}>
          <GrokIcon name={icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn(rowTitleCls, "font-medium")}>{title}</span>
          {hint && <span className={cn(rowHintCls, "text-pretty")}>{hint}</span>}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-full",
            checked ? "bg-ink text-app" : "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-ink)_20%,transparent)]",
          )}
        >
          {checked && <GrokIcon name="check" size={12} />}
        </span>
      </button>
      {children}
    </div>
  );
}
