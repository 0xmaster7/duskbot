import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openPlaceAction, placeHasIssue } from "@/lib/place-view";
import { useStore, type Bot } from "@/state/store";
import type { GrokIconName } from "../../GrokIcon";
import { usePlaceViews } from "../../PlaceChip";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { DialogChoice, DialogSection, footnoteCls, GrokDialog, smallButtonCls } from "../../ui/GrokDialog";
import type { PlaceActionId } from "../../../../shared/place-view";
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
  cloud: () => "A desktop in the cloud that runs while yours sleeps",
};

// steps choosing the cloud row carries out by itself
const ON_CHOOSE: ReadonlySet<PlaceActionId> = new Set(["watch", "open-computer-panel", "turn-on-browser", "start", "wake", "try-again"]);

/** Where the bot works, kept to this computer and the cloud desktop: the chosen one checked, and the cloud's one setup
 * step under its row when it needs one. */
export function WhereModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const { options, current, usingNow, choosePlace, warning } = usePlacePicker(bot, derived);
  const cloud = usePlaceViews(bot).cloud;
  const title = t("computer.simple.whereWorks", { name: bot.name });
  const editable = bot.yourAccess !== "view";
  const rows = options.filter((option) => option.value === "local" || option.value === "cloud" || option.value === current);
  const setup = cloud.policy && (!cloud.reachable || placeHasIssue(cloud.view)) && cloud.view.action && !ON_CHOOSE.has(cloud.view.action.id)
    ? cloud.view.action : null;

  return (
    <GrokDialog
      data-panel-modal="where"
      title={title}
      description={`The computer ${bot.name} uses for apps and files.`}
      onClose={onClose}
      footer={usingNow && <span data-panel-using-now className="mr-auto truncate pl-2 text-[12px] leading-4 tracking-[0.01em] text-ink/56">{t("computer.simple.usingNow", { place: usingNow })}</span>}
    >
      <div className="flex flex-col gap-2.5">
        <DialogSection>
          <div role="radiogroup" aria-label={title} className="flex flex-col">
            {rows.map((option) => (
              <DialogChoice
                key={option.value}
                data-panel-choice={option.value}
                icon={PLACE_ICON[option.value]}
                title={option.label}
                hint={option.hint ?? PLACE_LINE[option.value]?.(bot.name)}
                checked={current === option.value}
                disabled={option.disabled || !editable}
                onSelect={() => choosePlace(option.value)}
              >
                {option.value === "cloud" && setup && editable && (
                  <div className="flex pb-1.5 pl-[46px]">
                    <button
                      type="button"
                      data-panel-cloud-setup={setup.id}
                      className={smallButtonCls}
                      onClick={() => {
                        onClose();
                        openPlaceAction(setup.id, { botId: bot.id, threadId: bot.threadId, place: "cloud" }, dispatch);
                      }}
                    >
                      {setup.label}
                    </button>
                  </div>
                )}
              </DialogChoice>
            ))}
          </div>
        </DialogSection>
        {!editable && <p className={cn(footnoteCls)}>Only people who can edit {bot.name} can change this.</p>}
        {warning}
      </div>
    </GrokDialog>
  );
}
