import type { CSSProperties } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ELEVATED_FLOAT, ELEVATED_TINT } from "./elevated";

export function JumpToLatestButton({ onClick, className, style }: { onClick: () => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={t("chat.jumpToLatestAria")}
      title={t("chat.jumpToLatest")}
      className={cn("animate-pop-in absolute left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", ELEVATED_FLOAT, ELEVATED_TINT, className)}
      style={style}
    >
      <ArrowDown size={17} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
