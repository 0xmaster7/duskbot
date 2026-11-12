// A bot computer's problem in plain words with one way out. The server's own sentence (image, container, network
// details) stays available behind Advanced; the tab leads with what a person can do about it.
import type { LocaleKey } from "@/locales";

/** `replace`: a new computer on the VPS from the current version, on the bot's home volume; `retry`: look again or wake
 * it again; `settings`: the person has a step to take in Settings (an occupied name, a VPS that isn't set up). */
export type ComputerFix = "replace" | "retry" | "settings";

export interface ComputerProblem {
  line: LocaleKey;
  fix: ComputerFix;
  /** What Fix keeps: the home volume of a bot desktop, nothing of an older Cua desktop's insides. */
  keepsFiles: boolean;
}

export interface ComputerProblemInput {
  phase: string;
  /** The panel has an error to show at all. */
  failed: boolean;
  vps?: { configured?: boolean; managed?: boolean; container?: string; daemonUp?: boolean; desktop?: string; teamComputer?: unknown } | null;
}

export function computerProblem({ phase, failed, vps }: ComputerProblemInput): ComputerProblem | null {
  const keepsFiles = vps?.desktop !== "cua";
  if (phase === "vps-incompatible") {
    if (vps?.managed === false) return { line: "computer.problem.notOurs", fix: "settings", keepsFiles };
    // a team's shared computer is replaced from the Team map, never from one bot's tab
    return { line: "botPanel.screen.updateReady", fix: vps?.teamComputer ? "settings" : "replace", keepsFiles };
  }
  if (!failed) return null;
  if (phase === "error" && vps?.configured && vps.daemonUp === false) return { line: "computer.problem.unreachable", fix: "retry", keepsFiles };
  if (phase === "error" || phase === "vm-unavailable" || phase === "starting") return { line: "computer.problem.failed", fix: "retry", keepsFiles };
  return null;
}
