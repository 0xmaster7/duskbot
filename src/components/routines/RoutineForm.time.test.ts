import { describe, expect, it } from "vitest";
import { parseTypedTime } from "./RoutineForm";

describe("typed routine times", () => {
  it.each([
    ["9", "09:00"], ["9am", "09:00"], ["9 pm", "21:00"], ["9:30 PM", "21:30"], ["21:30", "21:30"], ["930", "09:30"],
    ["12am", "00:00"], ["12 pm", "12:00"], ["7.15", "07:15"], [" 08:05 ", "08:05"],
  ])("reads %s as %s", (typed, time) => expect(parseTypedTime(typed)).toBe(time));
  it.each(["25:00", "9:75", "13pm", "noon", ""])("refuses %s", (typed) => expect(parseTypedTime(typed)).toBeNull());
});
