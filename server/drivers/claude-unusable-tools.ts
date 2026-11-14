// Built-in Claude Code tools that work only in Claude Code's own terminal or app, yet ride every model call of a bot turn at
// about 4,900 tokens: Workflow runs in the background, which a turn turns off, and needs a person opting in at /workflows;
// ScheduleWakeup paces a /loop, where a bot has wait_until; ReportFindings draws in a host UI there is none of; ListAgents
// lists this machine's other Claude sessions. An engine or a guest turn that lists its own tools has left them out already,
// and a bot that inherits this machine's setup keeps them.
export const BUILT_INS_NO_BOT_CAN_USE = ["Workflow", "ScheduleWakeup", "ReportFindings", "ListAgents"] as const;

export function unusableBuiltIns(turn: { isolated: boolean; listsTools: boolean; guest: boolean }): readonly string[] {
  return turn.isolated && !turn.listsTools && !turn.guest ? BUILT_INS_NO_BOT_CAN_USE : [];
}

/** Claude Code's WebFetch, and its built-in web-fetch agent that runs on it, read pages around dusk bot's browser, where the
 * person cannot watch them; with that browser mounted, pages are read there. */
export function toolsAroundBrowser(turn: { browser: boolean; guest: boolean; listed?: readonly string[] }): readonly string[] {
  return turn.browser && !turn.guest && (!turn.listed || turn.listed.includes("WebFetch")) ? ["WebFetch"] : [];
}
