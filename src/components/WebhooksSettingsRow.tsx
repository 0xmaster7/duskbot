import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { Card, NavRow } from "./ListRows";

/** Webhook triggers live with the other automations: this row only leads there. */
export function WebhooksSettingsRow() {
  const { state, dispatch } = useStore();
  // a remote client's Automations page lists schedules only
  if (typeof window !== "undefined" && window.ogb?.remoteClient?.active === true) return null;
  const count = state.webhooks?.length ?? 0;
  return (
    <Card data-settings-block="webhooks">
      <NavRow
        data-settings-open="webhooks"
        title={t("settings.webhooks.title")}
        hint={t("settings.webhooks.hint")}
        value={count > 0 ? String(count) : undefined}
        onClick={() => dispatch({ type: "showRoutines", view: "list" })}
      />
    </Card>
  );
}
