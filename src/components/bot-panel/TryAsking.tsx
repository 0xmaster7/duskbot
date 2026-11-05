import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useStore, type Bot } from "@/state/store";
import { HELPER_ASK_KEYS } from "../HelperIntro";
import { Card } from "./rows";

/** MausBot's example asks, in its panel (Simple mode): a tap sends one in the open conversation. */
export function TryAsking({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const advanced = useAdvancedMode();
  if (advanced || !bot.defaultBot) return null;
  return (
    <Card label={t("botPanel.tryAsking")} anchor="try-asking">
      {HELPER_ASK_KEYS.map((key) => (
        <button key={key} type="button" data-panel-ask={key}
          onClick={() => dispatch({ type: "send", botId: bot.id, text: t(key), threadId: bot.threadId })}
          className="flex min-h-[30px] w-full items-center rounded-lg px-2 py-1.5 text-left text-[13px] leading-[18px] tracking-[0.015em] text-ink hover:bg-ink/[0.06]">
          <span className="truncate">{t(key)}</span>
        </button>
      ))}
    </Card>
  );
}
