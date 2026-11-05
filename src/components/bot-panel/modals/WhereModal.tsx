import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { GrokIconName } from "../../GrokIcon";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { DialogChoice, DialogSection, footnoteCls, GrokDialog } from "../../ui/GrokDialog";
import { usePlacePicker, type PlaceChoice } from "../ComputerTab";

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

/** Where the bot works, one row per computer it can use: the chosen one checked, a place it cannot reach greyed
 * with the reason. */
export function WhereModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const { options, current, usingNow, choosePlace, warning } = usePlacePicker(bot, derived);
  const title = t("computer.simple.whereWorks", { name: bot.name });
  const editable = bot.yourAccess !== "view";

  return (
    <GrokDialog
      data-panel-modal="where"
      title={title}
      description={`The computer ${bot.name} uses when a task needs apps, files or a browser.`}
      onClose={onClose}
      footer={usingNow && <span data-panel-using-now className="mr-auto truncate pl-2 text-[12px] leading-4 tracking-[0.01em] text-ink/56">{t("computer.simple.usingNow", { place: usingNow })}</span>}
    >
      <div className="flex flex-col gap-2.5">
        <DialogSection label="Computer">
          <div role="radiogroup" aria-label={title} className="flex flex-col">
            {options.map((option) => (
              <DialogChoice
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
        </DialogSection>
        {!editable && <p className={cn(footnoteCls)}>Only people who can edit {bot.name} can change this.</p>}
        {warning}
      </div>
    </GrokDialog>
  );
}
