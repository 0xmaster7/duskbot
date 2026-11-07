import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { Switch } from "../SettingsPrimitives";
import { useMacControl } from "../MacControlRow";
import type { BotPatch } from "./useBotSettingsDerived";

/** On a linked VPS once the owner's Mac served it: whether this bot may use that Mac. */
export function MacAccessCard({ bot, patch }: { bot: Bot; patch: (patch: BotPatch) => void }) {
  const [status] = useMacControl();
  if (!status?.available) return null;
  const on = bot.macControl !== false;
  const line = !status.enabled ? t("botAccess.mac.offEverywhere") : !on ? t("botAccess.mac.off") : t("botAccess.mac.on", { name: status.name ?? "Mac" });
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4" data-testid="access-mac">
      <div>
        <div className="text-[15px] font-medium text-ink">{t("botAccess.mac.title")}</div>
        <div className="mt-0.5 text-[13px] text-ink-secondary">{line}</div>
      </div>
      <Switch
        checked={status.enabled && on}
        aria-label={t("botAccess.mac.title")}
        disabled={!status.enabled}
        onClick={() => patch({ macControl: !on })}
        className="disabled:cursor-not-allowed"
      />
    </div>
  );
}
