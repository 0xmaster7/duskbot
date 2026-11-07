import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { writeComputerPanelView, type ComputerPanelView } from "@/lib/computer-panel-view";
import { t } from "@/lib/i18n";
import type { Place } from "@/lib/place";
import { openPlaceAction, placeHasIssue, worksOnSimpleLabel } from "@/lib/place-view";
import { useStore, type Bot } from "@/state/store";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { usePlaceViews } from "../PlaceChip";
import type { GrokIconName } from "../GrokIcon";
import { SelectPill } from "../ui/SelectPill";
import type { BotPatch, useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import type { PlaceActionId } from "../../../shared/place-view";
import type { SimplePageId } from "./page-registry";
import { Card, RadioRow } from "./rows";
import { AsleepMascot, COMPUTER_FRAME_CLASS, COMPUTER_SCREEN_ASPECT } from "./ComputerScreenMascot";
import "./computer-tab.css";

const ComputerPanel = lazy(() => import("../ComputerPanel").then((module) => ({ default: module.ComputerPanel })));

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

const PANEL_ACTIONS: ReadonlySet<PlaceActionId> = new Set(["watch", "open-computer-panel", "turn-on-browser", "start", "wake", "try-again"]);

/** Whether the element is in view; the live screen pauses while the panel is scrolled away or covered by layout. */
function useOnScreen(element: HTMLElement | null) {
  const [onScreen, setOnScreen] = useState(true);
  const last = useRef(true);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      const next = Boolean(entry?.isIntersecting);
      if (next !== last.current) setOnScreen((last.current = next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return onScreen;
}

type TabChoice = PlaceChoice | "add";

const CHOICE_ICON: Record<TabChoice, GrokIconName> = {
  auto: "sparkle",
  local: "laptop",
  browser: "browser",
  cloud: "cloud",
  vm: "lock",
  off: "minus",
  add: "plus",
};

export function ComputerTab({ bot, derived }: { bot: Bot; derived: Derived; onOpen: (page: SimplePageId) => void }) {
  const { dispatch } = useStore();
  const { options, current, usingNow, choosePlace, warning } = usePlacePicker(bot, derived);
  const placeViews = usePlaceViews(bot);
  const [screenBox, setScreenBox] = useState<HTMLElement | null>(null);
  const onScreen = useOnScreen(screenBox);
  const screenOf = t("computer.screenOf", { name: bot.name });
  const whereTitle = t("computer.simple.whereWorks", { name: bot.name });
  const editable = bot.yourAccess !== "view";
  const choices = [
    ...options.filter((option) => option.value === "local" || option.value === "cloud" || option.value === current),
    { value: "add" as const, label: t("computer.simple.addCloud") },
  ];
  const addCloud = () => {
    const step = placeViews.cloud.view.action;
    if (step && !PANEL_ACTIONS.has(step.id) && openPlaceAction(step.id, { botId: bot.id, threadId: bot.threadId, place: "cloud" }, dispatch)) return;
    dispatch({ type: "toggleAppSettings", open: true, section: "computer" });
  };

  return (
    <div data-panel-tabpanel="computer">
      <div ref={setScreenBox}>
        <Suspense fallback={<div data-panel-screen="" data-stage={current === "off" ? "off" : "asleep"} className={COMPUTER_FRAME_CLASS} style={{ aspectRatio: String(COMPUTER_SCREEN_ASPECT) }}><AsleepMascot bot={bot} /><span className="max-w-[80%] font-medium text-ink">{t(current === "off" ? "place.view.off.short" : "botPanel.screen.resting")}</span></div>}>
          <ComputerPanel bot={bot} inline visible={onScreen} />
        </Suspense>
      </div>
      <div className="mt-[5px] flex min-h-6 items-center justify-between gap-2 pl-1">
        <span data-panel-screen-of="" className="min-w-0 truncate text-[12px] leading-4 tracking-normal text-ink/[0.56]">{screenOf}</span>
        <SelectPill<TabChoice>
          data-panel-select="place"
          aria-label={whereTitle}
          title={usingNow ? t("computer.simple.usingNow", { place: usingNow }) : whereTitle}
          value={current}
          disabled={!editable}
          onChange={(value) => value === "add" ? addCloud() : choosePlace(value)}
          options={choices.map((option) => ({
            value: option.value, label: option.label, icon: CHOICE_ICON[option.value], separated: option.value === "add",
            disabled: "disabled" in option ? option.disabled : undefined, title: "hint" in option ? option.hint : undefined,
          }))}
          className="my-0 mr-0"
        />
      </div>
      {warning}
    </div>
  );
}
