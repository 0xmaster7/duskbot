import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { GrokIconName } from "../../GrokIcon";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { usePlacePicker, type PlaceChoice } from "../ComputerTab";
import { ChoiceCard } from "./ChoiceCard";
import { kitPrimaryCls, ModalSheet, rowHintCls } from "./ModalSheet";

const PLACE_ICON: Record<PlaceChoice, GrokIconName> = {
  auto: "sparkle",
  local: "device-desktop",
  browser: "browser",
  cloud: "cloud",
  vm: "lock",
  off: "minus",
};

const PLACE_LINE: Partial<Record<PlaceChoice, (name: string) => string>> = {
  auto: (name) => `${name} picks the right place for each task`,
  local: () => "Your apps, files and screen, right here",
  browser: () => "Its own browser, apart from yours",
  cloud: () => "A desktop in the cloud that runs while yours sleeps",
};

/** Where the bot works, as one card per computer it can use: the chosen one ringed, a place it cannot reach greyed with
 * the reason. */
export function WhereModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const { options, current, usingNow, choosePlace, warning } = usePlacePicker(bot, derived);
  const title = t("computer.simple.whereWorks", { name: bot.name });
  const editable = bot.yourAccess !== "view";

  return (
    <ModalSheet
      data-panel-modal="where"
      width={460}
      title={title}
      onClose={onClose}
      footer={(
        <>
          {usingNow && <span data-panel-using-now className="mr-auto truncate text-[12px] leading-4 tracking-[0.01em] text-ink/56">{t("computer.simple.usingNow", { place: usingNow })}</span>}
          <button type="button" onClick={onClose} className={kitPrimaryCls}><span>{t("common.done")}</span></button>
        </>
      )}
    >
      <div role="radiogroup" aria-label={title} className="flex flex-col gap-2">
        {options.map((option) => (
          <ChoiceCard
            key={option.value}
            data-panel-choice={option.value}
            icon={PLACE_ICON[option.value]}
            title={option.label}
            hint={option.hint ?? PLACE_LINE[option.value]?.(bot.name)}
            checked={current === option.value}
            disabled={option.disabled || !editable}
            onSelect={() => choosePlace(option.value)}
          />
        ))}
      </div>
      {!editable && <p className={cn(rowHintCls, "mt-3 px-0.5")}>Only people who can edit {bot.name} can change this.</p>}
      {warning}
    </ModalSheet>
  );
}
