import { routinePromptName } from "../../shared/routine-run";
import { formatTime } from "@/lib/format-time";
import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { Repeat } from "../icons";

/** A routine run's opening turn: the server marks it (`routineStart`); older lines are known by the prompt's header. */
export function routineStartName(message: Pick<Message, "role" | "text" | "routineStart">): string | null {
  if (message.role !== "user") return null;
  return message.routineStart ? message.routineStart.name : routinePromptName(message.text);
}

/** In place of the prompt a routine gave its bot, which is the bot's and never shown: the routine's name and when it ran. */
export function RoutineStartLine({ name, at }: { name: string; at: number }) {
  const time = formatTime(at);
  return (
    <div data-routine-start="" role="note" className="flex min-w-0 items-center justify-center gap-1.5 py-1 text-[12px] leading-4 text-ink-secondary">
      <Repeat size={13} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">{name ? t("routines.startLine", { name, time }) : t("routines.startLineUnnamed", { time })}</span>
    </div>
  );
}
