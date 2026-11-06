import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { rememberComputerPanelOpen } from "@/lib/computer-panel-focus";
import { writeComputerPanelView, type ComputerPanelView } from "@/lib/computer-panel-view";
import { t } from "@/lib/i18n";
import type { Place } from "@/lib/place";
import { openPlaceAction, placeHasIssue, worksOnSimpleLabel } from "@/lib/place-view";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar, MausAvatar } from "../Avatar";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { usePlaceViews } from "../PlaceChip";
import type { GrokIconName } from "../GrokIcon";
import { GrokIcon } from "../GrokIcon";
import { SelectPill } from "../ui/SelectPill";
import type { BotPatch, useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import type { PlaceActionId } from "../../../shared/place-view";
import { useBotScreen } from "./bot-screen";
import { LiveScreenVideo } from "./LiveScreenVideo";
import { primeLiveScreen } from "./local-screen-stream";
import type { SimplePageId } from "./page-registry";
import { Card, RadioRow } from "./rows";
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
  return (view: ComputerPanelView = "computer", keyboard = false) => {
    writeComputerPanelView(bot.id, view);
    rememberComputerPanelOpen({ botId: bot.id, opener: null, tabs: keyboard });
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
// the next step a place offers that the Screen panel carries out itself
const PANEL_ACTIONS: ReadonlySet<PlaceActionId> = new Set(["watch", "open-computer-panel", "turn-on-browser", "start", "wake", "try-again"]);

function AsleepMascot({ bot }: { bot: Bot }) {
  return (
    <span data-asleep-mascot="" className="relative flex size-8">
      <span className="computer-asleep-breathe flex">
        <MausAvatar color={bot.color} bodyId={bot.mascotBody ?? undefined} gradient={[ASLEEP_GREY, ASLEEP_GREY, ASLEEP_GREY]} size={32} state="sleeping" label={bot.name} />
      </span>
      <span aria-hidden="true" className="absolute inset-[4px_4px_28px_28px]">
        {[0, 4, 8].map((left) => <span key={left} className="computer-asleep-z" style={{ left }} />)}
      </span>
    </span>
  );
}

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

/** Grok's Computer tab: the bot's screen in its own frame (live, asleep or working), whose screen it is, and one select
 * for where it works: this computer, the cloud desktop, or adding a cloud computer. The screen opens the full view. */
export function ComputerTab({ bot, derived }: { bot: Bot; derived: Derived; onOpen: (page: SimplePageId) => void }) {
  const { dispatch } = useStore();
  const { options, current, usingNow, choosePlace, warning } = usePlacePicker(bot, derived);
  const placeViews = usePlaceViews(bot);
  const [screenBox, setScreenBox] = useState<HTMLElement | null>(null);
  const onScreen = useOnScreen(screenBox);
  const [full, setFull] = useState<{ wake: boolean } | null>(null);
  // the full view owns the live screen while it is open, as grok's preview hands its viewer over
  const { place, src, stream, loading, blocked } = useBotScreen(bot, { visible: onScreen && !full });
  // every state shares one 16:9 frame, like the other computers; a screen fills it centred
  const [, setRatio] = useState<number | null>(null);
  const screenOf = t("computer.screenOf", { name: bot.name });
  const whereTitle = t("computer.simple.whereWorks", { name: bot.name });
  const editable = bot.yourAccess !== "view";
  const choices = [
    ...options.filter((option) => option.value === "local" || option.value === "cloud" || option.value === current),
    { value: "add" as const, label: t("computer.simple.addCloud") },
  ];
  // the cloud's own setup step when it has one (a key, a plan), else Settings where computers are managed
  const addCloud = () => {
    const step = placeViews.cloud.view.action;
    if (step && !PANEL_ACTIONS.has(step.id) && openPlaceAction(step.id, { botId: bot.id, threadId: bot.threadId, place: "cloud" }, dispatch)) return;
    dispatch({ type: "toggleAppSettings", open: true, section: "computer" });
  };

  const known = place && place !== "auto" && place !== "off" ? placeViews[place] : null;
  const issue = known && (!known.reachable || placeHasIssue(known.view)) ? known.view : null;
  const stage = src || stream ? "screen" : place === undefined || loading ? "loading" : place === "off" ? "off" : bot.busy ? "working" : "asleep";
  const title = blocked ? t("computer.screen.unavailableNow") : issue ? issue.short : t("botPanel.screen.resting");
  const line = issue?.line && issue.line !== issue.short ? issue.line : null;
  const action = blocked ? t("place.action.openComputerPanel") : issue ? issue.action?.label : known?.view.action?.label ?? t("botPanel.screen.wake");

  const open = () => {
    const id = known?.view.action?.id;
    if (stage === "asleep" && !blocked && id && !PANEL_ACTIONS.has(id) && openPlaceAction(id, { botId: bot.id, threadId: bot.threadId, place: place as Place }, dispatch)) return;
    if (place === "local") primeLiveScreen();
    setFull({ wake: stage === "asleep" && (id === "wake" || id === "start") });
  };
  const frameCls = "relative flex w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] text-center text-[13px] leading-[18px] tracking-[0.015em] shadow-[inset_0_0_0_0.5px_var(--color-edge)]";
  const buttonCls = "cursor-pointer transition-[background-color] duration-100 hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_8%)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-ink)_22%,transparent)]";

  return (
    <div data-panel-tabpanel="computer">
      {stage === "off" || stage === "loading" ? (
        <div ref={setScreenBox} data-panel-screen="" data-stage={stage} aria-busy={stage === "loading" || undefined} className={cn(frameCls, "aspect-video")}>
          {stage === "off" && (
            <>
              <AsleepMascot bot={bot} />
              <span className="max-w-[80%] font-medium text-ink">{t("place.view.off.short")}</span>
            </>
          )}
        </div>
      ) : (
        <button
          ref={setScreenBox}
          type="button"
          data-panel-action="open-computer"
          data-stage={stage}
          data-place={place}
          aria-label={stage === "asleep" ? action ?? title : `${t("place.action.watch")}: ${screenOf}`}
          aria-haspopup="dialog"
          onClick={open}
          className={cn(frameCls, buttonCls, "group/screen", "aspect-video",
            stage === "screen" && "bg-transparent hover:bg-transparent")}
        >
          {stage === "screen" ? (
            <>
              {stream ? (
                <LiveScreenVideo stream={stream} playing={onScreen && !full} onRatio={(value) => setRatio(Math.max(1, value))} className="absolute inset-0 size-full object-cover" />
              ) : <img
                src={src!}
                alt=""
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                  if (width && height) setRatio(Math.max(1, width / height));
                }}
                className="absolute inset-0 size-full object-cover"
              />}
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_0.5px_var(--color-edge)]" />
              <span
                aria-hidden="true"
                data-panel-open-pill=""
                className="pointer-events-none relative z-[2] inline-flex items-center gap-1.5 rounded-full bg-[rgb(0_0_0/0.9)] px-2.5 py-2 text-[12px] leading-4 tracking-normal text-white opacity-0 transition-opacity duration-[120ms] ease-out group-hover/screen:opacity-100 group-focus-visible/screen:opacity-100"
              >
                <GrokIcon name="arrows-expand-simple" size={14} />
                {t("computer.open")}
              </span>
            </>
          ) : stage === "working" ? (
            <>
              <BotAvatar bot={bot} size={32} animated={false} />
              <span className="max-w-[80%] text-ink-secondary">{t("botPanel.screen.working")}</span>
            </>
          ) : (
            <>
              <AsleepMascot bot={bot} />
              <span className="max-w-[80%] font-medium text-ink">{title}</span>
              {line && <span className="-mt-1 max-w-[80%] text-[12px] leading-4 tracking-normal text-ink/[0.56]">{line}</span>}
              {action && (issue || blocked) && (
                <span aria-hidden="true" className="mt-1 inline-flex h-6 items-center rounded-lg border border-ink/[0.08] px-2 text-[12px] leading-4 tracking-normal text-ink">
                  {action}
                </span>
              )}
            </>
          )}
        </button>
      )}
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
      {full && (
        <Suspense fallback={null}>
          <ComputerPanel bot={bot} fullscreen={{ wake: full.wake, onExit: () => setFull(null) }} />
        </Suspense>
      )}
    </div>
  );
}
