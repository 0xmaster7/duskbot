// What the person did in the app, read from the store's actions: ids, counts and choices only. A message, an answer, a
// name or a setting's text is never read here; a bot setting's new value only when it is a switch or a number.
import { trail, type TrailFields } from "@/lib/trail";

type Action = { type: string } & Record<string, unknown>;

const PERSONAL_FIELD = /name|title|prompt|instruction|description|about|persona|avatar|email|note|soul|bio|greeting|path|folder|url|host|key|token|secret/i;
const str = (value: unknown): string | undefined => (typeof value === "string" ? value.slice(0, 80) : undefined);
const len = (value: unknown): number | undefined => (typeof value === "string" ? value.length : undefined);

/** a plain value of a setting that holds no private text: a switch, a number, a short lowercase choice */
export function safeSettingValue(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,30}$/.test(value)) return value;
  return undefined;
}

/** the event an action becomes, or null for actions the trail does not follow */
export function trailForAction(action: Action): { ev: string; fields: TrailFields } | null {
  switch (action.type) {
    case "send": return { ev: "chat.send", fields: { bot: str(action.botId), thread: str(action.threadId), sendId: str(action.sendId), len: len(action.text), mode: str(action.mode), followUp: action.followUp ? true : undefined } };
    case "sendGroup": return { ev: "chat.send", fields: { group: str(action.groupId), thread: str(action.threadId), sendId: str(action.sendId), len: len(action.text) } };
    case "editMessage": return { ev: "chat.edit", fields: { bot: str(action.botId), len: len(action.text) } };
    case "decideRequest": return { ev: "approval.decide", fields: { bot: str(action.botId), thread: str(action.threadId), request: str(action.requestId), behavior: str(action.behavior), scope: str(action.scope) } };
    case "answerCard": return { ev: "card.answer", fields: { bot: str(action.botId), group: str(action.groupId), len: len(action.answer) } };
    case "dismissCard": return { ev: "card.dismiss", fields: { bot: str(action.botId) } };
    case "interrupt": return { ev: "turn.stop", fields: { bot: str(action.botId) } };
    case "interruptGroup": return { ev: "turn.stop", fields: { group: str(action.groupId) } };
    case "runRoutine": return { ev: "routine.run", fields: { routine: str(action.routineId), test: action.test === true } };
    case "cancelRoutineRun": return { ev: "routine.cancel", fields: { routine: str(action.routineId) } };
    case "createRoutine": case "updateRoutine": case "deleteRoutine": return { ev: `routine.${action.type.replace("Routine", "")}`, fields: { routine: str(action.routineId) } };
    case "select": return { ev: "ui.nav", fields: { page: "chat", bot: str(action.id) } };
    case "newTask": case "switchTask": return { ev: "ui.nav", fields: { page: "task", bot: str(action.botId), task: str(action.taskId) } };
    case "newBot": case "duplicateBot": case "deleteBot": return { ev: `bot.${action.type.replace("Bot", "")}`, fields: { bot: str(action.botId) } };
    case "setModel": return { ev: "settings.change", fields: { bot: str(action.botId), key: "model", value: safeSettingValue(action.model) } };
    case "updateBot": {
      const patch = action.patch && typeof action.patch === "object" ? action.patch as Record<string, unknown> : {};
      const keys = Object.keys(patch).slice(0, 10);
      const values: Record<string, string | number | boolean | null> = {};
      // the key is always kept; the value only for a switch, a number or a choice, never for a field of words
      for (const key of keys) { const value = PERSONAL_FIELD.test(key) ? undefined : safeSettingValue(patch[key]); if (value !== undefined) values[key] = value; }
      return { ev: "settings.change", fields: { bot: str(action.botId), key: keys.join(","), values } };
    }
    default: return null;
  }
}

export function trailAction(action: Action): void {
  try {
    const event = trailForAction(action);
    if (event) trail(event.ev, event.fields);
  } catch { /* never */ }
}
