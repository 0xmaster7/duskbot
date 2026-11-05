// The day and time line between a conversation's days (ChatView.tsx).
import { cn } from "@/lib/cn";
import { dayLabel } from "@/lib/transcript-derivations";
import { formatTime } from "@/state/store";

export function DaySeparator({ at, today, simple = false }: { at: number; today: number; simple?: boolean }) {
  return (
    <div className={cn("text-center text-ink-secondary", simple ? "pt-2 pb-0.5 text-[12px] leading-4" : "py-3 text-[13px]")}>
      {dayLabel(at, today)} {formatTime(at)}
    </div>
  );
}
