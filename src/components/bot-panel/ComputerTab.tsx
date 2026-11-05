import { useState } from "react";

import { writeComputerPanelView, type ComputerPanelView } from "@/lib/computer-panel-view";
import { t } from "@/lib/i18n";
import type { Place } from "@/lib/place";
import { placeHasIssue, worksOnSimpleLabel } from "@/lib/place-view";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar, MausAvatar } from "../Avatar";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { usePlaceViews } from "../PlaceChip";
import { screenFramePreview } from "../ScreenFrame";
import type { BotPatch, useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import type { SimplePageId } from "./page-registry";
import { Card, RadioRow } from "./rows";
import "./computer-tab.css";

type Derived = ReturnType<typeof useBotSettingsDerived>;
export type PlaceChoice = "auto" | Place | "off";

interface PlaceOption {
  value: PlaceChoice;
  label: string;
  hint?: string;
  disabled?: boolean;
}

const EXTRA_PLACE_LABEL: Record<Exclude<PlaceChoice, "auto" | "local" | "cloud" | "browser">, () => string> = {
  vm: () => t("place.vm"),
  off: () => t("place.off"),
};

export function useOpenComputer(bot: Pick<Bot, "id">) {
  const { dispatch } = useStore();
  return (view: ComputerPanelView = "computer") => {
    writeComputerPanelView(bot.id, view);
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: true });
  };
}

export function usePlaceChoices(bot: Bot) {
  const { state } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const platform = capabilities.host?.platform ?? "other";
  const placeViews = usePlaceViews(bot);
  const current: PlaceChoice = bot.computer ?? "auto";
  const myChrome = state.config?.browserEngine?.myChrome === true
    && (state.config?.browserProfiles ?? []).some((profile) => profile.id === bot.browserProfile && profile.browser === "chrome");
  const placeLabel = (place: Place) => (place === "browser" && myChrome ? t("settings.profiles.myChrome") : worksOnSimpleLabel(place, platform));
  const choice = (place: Place): PlaceOption => {
    const { view, reachable } = placeViews[place];
    return { value: place, label: placeLabel(place), disabled: !reachable, hint: !reachable || placeHasIssue(view) ? view.line : undefined };
  };
  const options: PlaceOption[] = [
    { value: "auto", label: t("computer.simple.dest.letItChoose") },
    ...(placeViews.local.policy ? [choice("local")] : []),
    ...(placeViews.browser.policy || current === "browser" ? [choice("browser")] : []),
    ...(placeViews.cloud.policy ? [choice("cloud")] : []),
    ...(current === "vm" || current === "off" ? [{ value: current, label: EXTRA_PLACE_LABEL[current](), disabled: true }] : []),
  ];
  const liveSurface = bot.tasks?.find((task) => task.threadId === bot.threadId)?.surface;
  const usingNow = liveSurface && liveSurface !== current ? placeLabel(liveSurface) : null;
  const currentLabel = options.find((option) => option.value === current)?.label
    ?? (current === "auto" || current === "vm" || current === "off" ? undefined : placeLabel(current));
  return { options, current, currentLabel, usingNow };
}

/** Choosing where a bot works, as the panel and its dialog both do: a place it cannot use, or Off, is never chosen; this
 * computer for a bot that decides alone asks first, through `warning`. */
export function usePlacePicker(bot: Bot, derived: Derived) {
  const { dispatch } = useStore();
  const choices = usePlaceChoices(bot);
  const { current } = choices;
  const [localAutoWarning, setLocalAutoWarning] = useState<{ botId: string; patch: BotPatch } | null>(null);
  const { patch, approvalMode } = derived;
  const choosePlace = (value: PlaceChoice) => {
    if (value === current || value === "vm" || value === "off") return;
    if (value === "local" && approvalMode === "auto") {
      setLocalAutoWarning({ botId: bot.id, patch: { computer: "local", acknowledgeLocalAuto: true } });
      return;
    }
    patch(value === "browser" ? { computer: "browser", browser: true } : { computer: value === "auto" ? null : value });
  };
  const warning = (
    <LocalComputerAutoWarning
      open={localAutoWarning !== null}
      onCancel={() => setLocalAutoWarning(null)}
      onConfirm={() => {
        const target = localAutoWarning;
        setLocalAutoWarning(null);
        if (!target) return;
        dispatch({ type: "updateBot", botId: target.botId, patch: target.patch });
      }}
    />
  );
  return { ...choices, choosePlace, warning };
}

export function WherePage({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { options, current, usingNow, choosePlace, warning } = usePlacePicker(bot, derived);

  return (
    <>
      <Card>
        <div role="radiogroup" aria-label={t("computer.simple.whereWorks", { name: bot.name })} className="flex flex-col divide-y divide-ink/[0.05]">
          {options.map((option) => (
            <RadioRow
              key={option.value}
              data-panel-choice={option.value}
              title={option.label}
              hint={option.hint}
              checked={current === option.value}
              disabled={option.disabled}
              onClick={() => choosePlace(option.value)}
            />
          ))}
        </div>
      </Card>
      {usingNow && <p data-panel-using-now className="mx-1 text-[13px] text-ink-secondary">{t("computer.simple.usingNow", { place: usingNow })}</p>}
      {warning}
    </>
  );
}

// grok paints the sleeping mascot in 56% ink, so it sits a step darker than the grey tile behind it
const ASLEEP_GREY = "color-mix(in srgb, var(--color-ink) 56%, transparent)";

/** Grok's Computer tab: the bot's screen in a 16:10 frame (asleep, working or its latest frame) and whose screen it is. */
export function ComputerTab({ bot }: { bot: Bot; derived: Derived; onOpen: (page: SimplePageId) => void }) {
  const openComputer = useOpenComputer(bot);
  const screenOf = t("computer.screenOf", { name: bot.name });

  const screen = [...bot.messages].reverse().find((message) => message.kind === "screen" && (message.hasImage || message.png));
  const screenSrc = screen ? screenFramePreview({ threadId: bot.threadId, messageId: screen.id }, screen.mime).src : null;
  const stage = screenSrc ? "screen" : bot.busy ? "working" : "asleep";

  return (
    <div data-panel-tabpanel="computer">
      <button
        type="button"
        data-panel-action="open-computer"
        data-stage={stage}
        aria-label={stage === "asleep" ? t("botPanel.screen.wake") : `${t("place.action.watch")}: ${screenOf}`}
        onClick={() => openComputer()}
        className="relative flex aspect-[16/10] w-full cursor-pointer flex-col text-[13px] leading-[18px] tracking-[0.015em] items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] text-center shadow-[inset_0_0_0_0.5px_var(--color-edge)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {stage === "screen" ? (
          <img src={screenSrc!} alt="" className="absolute inset-0 size-full object-cover" />
        ) : stage === "working" ? (
          <>
            <BotAvatar bot={bot} size={32} animated={false} />
            <span className="max-w-[80%] text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{t("botPanel.screen.working")}</span>
          </>
        ) : (
          <>
            <span data-asleep-mascot="" className="relative flex size-8">
              <span className="computer-asleep-breathe flex">
                <MausAvatar color={bot.color} bodyId={bot.mascotBody ?? undefined} gradient={[ASLEEP_GREY, ASLEEP_GREY, ASLEEP_GREY]} size={32} state="sleeping" label={bot.name} />
              </span>
              <span aria-hidden="true" className="absolute inset-[4px_4px_28px_28px]">
                {[0, 4, 8].map((left) => <span key={left} className="computer-asleep-z" style={{ left }} />)}
              </span>
            </span>
            <span className="max-w-[80%] text-[13px] font-medium leading-[18px] tracking-[0.015em] text-ink">{t("botPanel.screen.resting")}</span>
          </>
        )}
      </button>
      <div className="mt-[9px] text-center text-[12px] leading-4 text-ink-tertiary">{screenOf}</div>
    </div>
  );
}
