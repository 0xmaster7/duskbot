import { routinePromptName } from "../../shared/routine-run";
import type { Message } from "@/state/store";

/** A routine run's opening turn: the server marks it (`routineStart`); older lines are known by the prompt's header. The
 * prompt is the bot's and never shown, so a run reads in the chat as the bot's reply alone. */
export function routineStartName(message: Pick<Message, "role" | "text" | "routineStart">): string | null {
  if (message.role !== "user") return null;
  return message.routineStart ? message.routineStart.name : routinePromptName(message.text);
}
