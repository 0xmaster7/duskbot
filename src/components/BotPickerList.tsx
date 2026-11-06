import { Check } from "lucide-react";
import type { Bot } from "@/state/store";
import { teamBotName, useTeamPeople } from "@/state/team-people";
import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";

export function BotPickerList({
  bots,
  picked,
  onToggle,
  emptyHint,
}: {
  bots: Bot[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  emptyHint: string;
}) {
  const team = useTeamPeople();
  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
      {bots.length === 0 && <div className="px-2 py-4 text-center text-[13px] leading-[18px] text-ink/68">{emptyHint}</div>}
      {bots.map((b) => (
        <button
          key={b.id}
          onClick={() => onToggle(b.id)}
          role="checkbox"
          aria-label={teamBotName(b, team)}
          aria-checked={picked.has(b.id)}
          type="button"
          className="flex h-8 shrink-0 items-center gap-2 rounded-[8px] px-2 text-left transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
        >
          <BotAvatar bot={b} state="happy" size={20} animated={false} />
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{teamBotName(b, team)}</span>
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-[120ms] ease-[ease]",
              picked.has(b.id) ? "border-ink bg-ink text-app" : "border-ink/24",
            )}
          >
            {picked.has(b.id) && <Check size={10} strokeWidth={3} />}
          </span>
        </button>
      ))}
    </div>
  );
}
