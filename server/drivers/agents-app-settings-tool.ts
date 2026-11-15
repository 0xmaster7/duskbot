import { APP_PREF_NAMES } from "../../shared/app-prefs.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const APP_SETTINGS_TOOL_NAMES: ReadonlySet<string> = new Set(["app_settings"]);
export const APP_SETTINGS_PATH = "/api/internal/app-settings";

export async function callAppSettingsTool(_name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const action = args.action === "set" ? "set" : args.action === "list" || args.action === undefined ? "list" : null;
  if (!action) return { text: "app_settings action is list or set.", isError: true };
  const body = action === "list" ? { action } : { action, setting: args.setting, value: args.value };
  const { ok, body: answer } = await context.client.apiResponse(APP_SETTINGS_PATH, { method: "POST", body: JSON.stringify(body) });
  return ok ? { text: String(answer.text ?? "Done.") } : { text: String(answer.error ?? "The setting could not be changed."), isError: true };
}

export const APP_SETTINGS_TOOL_DEFINITIONS = [
  {
    name: "app_settings",
    description:
      "The person's app preferences (theme, font, chat width, send key, language): list them with their allowed values, or set one the person asked for. Applies on all their screens at once.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "set"] },
        setting: { type: "string", enum: [...APP_PREF_NAMES] },
        value: { type: "string", description: "set: an allowed value from list." },
      },
    },
  },
];
