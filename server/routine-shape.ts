// A quiet cost lever on new routines only, where it costs the person nothing: a frequent one (every six hours or more
// often) made without a time window runs in their waking hours, so a Cloud home can sleep at night, and the first
// morning check reads everything since the last, so nothing is missed. A daily or rarer one made without a timing
// runs "around" its time. Anything time-critical, or that asks for nights or all day, keeps its schedule, and so does
// anything unsure. Existing routines are never touched: only a person's or a bot's create passes through here.
import type { RoutineIntervalWindow, RoutineScheduleInput } from "../shared/routines.ts";
import { clockMinutes } from "./routine-intervals.ts";
import type { RoutineInput } from "./routines.ts";
import { WAKING_FALLBACK } from "./waking-hours.ts";

/** Every six hours or more often. */
export const FREQUENT_MINUTES = 360;

// time-critical work or a person asking for nights: the schedule stays as asked
const URGENT = new RegExp([
  String.raw`\burgent`, String.raw`\bimmediately\b`, String.raw`\basap\b`, String.raw`\bas soon as\b`, String.raw`\bright away\b`,
  String.raw`\bany ?time\b`, String.raw`\b24 ?/ ?7\b`, String.raw`\b(?:all|round|around) the clock\b`, String.raw`\b(?:over ?night|all night|at night|nightly|midnight)\b`,
  String.raw`\b(?:is |goes |went |site |server |service |website )?(?:down|offline|outage|unreachable)\b`, String.raw`\buptime\b`, String.raw`\bincident`,
  String.raw`\bsecurity\b`, String.raw`\bbreach`, String.raw`\bintrusion`, String.raw`\bfraud`, String.raw`\bsuspicious\b`,
  String.raw`\btrad(?:e|es|ing)\b`, String.raw`\bstop.?loss\b`, String.raw`\b(?:drops?|falls?|rises?|goes|gets|hits?) (?:below|under|above|over|to)\b`,
  String.raw`\b(?:below|under|above|over) [$€£₹¥]?\d`, String.raw`\bthreshold`,
].join("|"), "i");
// a time the person pinned: it stays exact
const PINNED = /\b(?:sharp|exactly|on the dot|precisely|no later than|not a minute)\b/i;

/** Wording that makes a routine time-critical, or asks for it at night or all day. */
export const timeCritical = (text: string): boolean => URGENT.test(text);

let wakingWindow: () => RoutineIntervalWindow | null = () => WAKING_FALLBACK;
/** The person's learned waking hours (server/waking-hours.ts); the fallback until the server sets it. */
export function useWakingWindow(window: () => RoutineIntervalWindow | null): void { wakingWindow = window; }

const inside = (time: string, window: RoutineIntervalWindow) => {
  const at = clockMinutes(time), start = clockMinutes(window.start), end = clockMinutes(window.end);
  return at !== null && start !== null && end !== null && at >= start && at < end;
};

/** The routine a create would make, shaped where it costs the person nothing; the input itself when unsure. */
export function shapeNewRoutine<T extends RoutineInput>(input: T, window: RoutineIntervalWindow | null = wakingWindow()): T {
  if (!input || typeof input !== "object" || !input.schedule || typeof input.schedule !== "object") return input;
  const words = `${input.name ?? ""}\n${input.prompt ?? ""}`;
  if (timeCritical(words) || input.probe?.kind === "price" || (input.target ?? "bot") !== "bot") return input;
  const schedule = input.schedule as RoutineScheduleInput;
  if (schedule.type === "interval") {
    if (!window || Object.hasOwn(schedule, "window") || !(schedule.everyMinutes <= FREQUENT_MINUTES)) return input;
    const length = clockMinutes(window.end)! - clockMinutes(window.start)!;
    return length >= schedule.everyMinutes ? { ...input, schedule: { ...schedule, window } } : input;
  }
  if (schedule.type === "daily" && !Object.hasOwn(input, "timing") && !PINNED.test(words)) {
    // a run at a time the person is usually asleep is theirs to keep exact
    if (window && !inside(schedule.time, window)) return input;
    return { ...input, timing: "around" };
  }
  return input;
}
