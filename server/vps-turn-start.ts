import { vpsStartsForTurn } from "./vps-computer.ts";

/**
 * What a turn does with a bot's own VPS desktop before the model runs. "start" wakes or creates it now, "lazy" mounts it
 * only when it is already awake and otherwise leaves it asleep until the bot asks for it with select_computer, "inspect"
 * only looks. On Auto, and on a place the bot picked itself earlier, a chat turn that can pick its computer is lazy, so a
 * plain reply never wakes a desktop. A place the person chose, and turns that cannot pick (a schedule, a handoff, the
 * continuation after a pick), start it as before; idle sleep and the host cap bound those.
 */
export function vpsTurnStartPlan(input: {
  wants: "cloud" | "vm" | "local" | "off" | undefined;
  autoStart: boolean;
  autoStartVps?: boolean;
  automationSource?: string;
  canSelect: boolean;
  /** the person chose this computer (Works on, their own pin, a routine), rather than Auto or the bot's own earlier pick */
  chosen?: boolean;
}): "start" | "lazy" | "inspect" {
  if (!input.autoStart || !vpsStartsForTurn(input)) return "inspect";
  return input.canSelect && !input.automationSource && (input.wants === undefined || (input.wants === "cloud" && !input.chosen)) ? "lazy" : "start";
}

export const LAZY_VPS_NOTE = " This bot's own VPS computer is asleep and starts on demand. Keep ordinary conversation computer-free. When the task needs browsing, files on that computer, or desktop actions, call select_computer with surface=cloud yourself; it wakes the computer and continues this request.";
