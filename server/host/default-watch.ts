import type { Routine, RoutineScheduleInput } from "../routines.ts";

export const WATCH_NAME = "Keep an eye on my day";
export const WATCH_INSTRUCTIONS = [
  "Keep an eye on my day for me.",
  "- Email: pick what I must not miss: mail that needs my reply, mail from someone I meet today, and anything with a deadline. Leave out newsletters, receipts and notifications.",
  "- Meetings: before a meeting with other people, prepare me in a few lines: who they are, why we are meeting, what is still open, and one next step.",
].join("\n");
export const WATCH_TIME = "08:00";
const FIRST_WATCH_EVERY_MINUTES = 15;
export const WATCH_SUGGESTION_TEXT = "Want me to keep an eye on your day? Every morning I'll pick out the email you shouldn't miss and get you ready for your meetings.";

export const watchSchedule = (): RoutineScheduleInput => ({ type: "daily", time: WATCH_TIME, weekdays: [0, 1, 2, 3, 4, 5, 6] });

/** The default watch as the server made it: on, and named, worded and timed as made. One the person paused or changed
 * is theirs. */
export function watchAsMade(routine: Pick<Routine, "name" | "prompt" | "enabled" | "deliver" | "schedule">): boolean {
  if (routine.deliver !== "brief" || !routine.enabled || routine.name !== WATCH_NAME || routine.prompt !== WATCH_INSTRUCTIONS) return false;
  const { schedule } = routine;
  if (schedule.type === "interval") return schedule.everyMinutes === FIRST_WATCH_EVERY_MINUTES;
  return schedule.type === "daily" && schedule.time === WATCH_TIME && schedule.weekdays.length === 7;
}
