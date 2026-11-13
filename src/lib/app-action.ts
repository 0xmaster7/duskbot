import { t } from "./i18n";
import type { OptionCardData } from "@/state/store";

/** A connected app's tool call in plain words: "Create a page in Notion: Launch checklist". */
export function appActionLine(card: Pick<OptionCardData, "appAction"> | undefined): string | undefined {
  const action = card?.appAction;
  if (!action) return undefined;
  return action.target
    ? t("approval.app.lineTarget", { action: action.action, app: action.app, target: action.target })
    : t("approval.app.line", { action: action.action, app: action.app });
}
