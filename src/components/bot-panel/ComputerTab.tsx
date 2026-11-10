import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { Cloud, Laptop, Monitor, Server, type LucideIcon } from "lucide-react";

import { cloudMoveStage, openCloudMove, runsOnHost, runsOnStatus, type CloudMoveStage, type RunsOnHost, type RunsOnKind, type RunsOnStatus } from "@/lib/cloud-move";
import { cn } from "@/lib/cn";
import { writeComputerPanelView, type ComputerPanelView } from "@/lib/computer-panel-view";
import { t } from "@/lib/i18n";
import type { Place } from "@/lib/place";
import { desktopShowsOtherServer, useOtherServerName } from "@/lib/other-server";
import { placeHasIssue, worksOnSimpleLabel } from "@/lib/place-view";
import { openAddVps, vpsLinkAvailable } from "@/lib/vps-link";
import { useStore, type Bot } from "@/state/store";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { usePlaceViews } from "../PlaceChip";
import type { GrokIconName } from "../GrokIcon";
import { SelectPill } from "../ui/SelectPill";
import type { BotPatch, useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import type { SimplePageId } from "./page-registry";
import type { InlineReport } from "../ComputerPanel";
import { deviceWord } from "../vps-link/parts";
import { Card, Disclosure, NavRow, NoteRow, RadioRow, RowIcon, RowText, rowCls } from "./rows";
import { pillPrimaryCls } from "../ListRows";
import { CloudDesktopListRow, useCloudDesktop, type CloudDesktopRow } from "./CloudDesktop";
import { AsleepMascot, COMPUTER_FRAME_CLASS, COMPUTER_SCREEN_ASPECT, COMPUTER_WAKE_BUTTON_CLASS, ComputerWaking } from "./ComputerScreenMascot";
import { queueComputerWake } from "./computer-wake-queue";
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
 * computer for a bot that decides alone asks first, through `warning`. `cloudDesktop`: the cloud desktop row beside the choices, in
 * the desktop app only; choosing it runs its own step and never changes the bot's place (its confirm is in `warning`). */
export function usePlacePicker(bot: Bot, derived: Derived) {
  const { dispatch } = useStore();
  const choices = usePlaceChoices(bot);
  const { current } = choices;
  const [localAutoWarning, setLocalAutoWarning] = useState<{ botId: string; patch: BotPatch } | null>(null);
  const cloudDesktop = useCloudDesktop();
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
    <>
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
    {cloudDesktop?.dialog}
    </>
  );
  return { ...choices, choosePlace, warning, cloudDesktop };
}

export function WherePage({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { options, current, usingNow, choosePlace, warning, cloudDesktop } = usePlacePicker(bot, derived);

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
      {cloudDesktop && <Card><CloudDesktopListRow cloudDesktop={cloudDesktop} /></Card>}
      {usingNow && <p data-panel-using-now className="mx-1 text-[13px] text-ink-secondary">{t("computer.simple.usingNow", { place: usingNow })}</p>}
      {warning}
    </>
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

/** The screen while the panel's code loads: already the wake button, and a click is kept for the panel to act on. */
export function AsleepScreen({ bot, off }: { bot: Bot; off: boolean }) {
  const [queued, setQueued] = useState(false);
  const label = t(off ? "place.view.off.short" : "botPanel.screen.resting");
  return (
    <div data-panel-screen="" data-stage={off ? "off" : queued ? "loading" : "asleep"} aria-busy={queued || undefined} className={COMPUTER_FRAME_CLASS} style={{ aspectRatio: String(COMPUTER_SCREEN_ASPECT) }}>
      {queued ? <ComputerWaking bot={bot} /> : (
        <button type="button" data-panel-action="open-computer" disabled={off} aria-label={off ? label : t("botPanel.screen.wake")}
          onClick={() => { queueComputerWake(bot.id); setQueued(true); }} className={COMPUTER_WAKE_BUTTON_CLASS}>
          <AsleepMascot bot={bot} />
          <span className="max-w-[80%] font-medium text-ink">{label}</span>
        </button>
      )}
    </div>
  );
}

const CHOICE_ICON: Record<PlaceChoice, GrokIconName> = {
  auto: "sparkle",
  local: "laptop",
  browser: "browser",
  cloud: "cloud",
  vm: "lock",
  off: "minus",
};

/** a quiet secondary move: plain 12px words that darken on hover, under the one primary action */
const quietCls = "inline-flex h-7 cursor-pointer items-center rounded-full px-2.5 text-[12px] leading-4 text-ink/[0.56] hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

const HOST_ICON: Record<RunsOnKind, LucideIcon> = { mac: Laptop, pc: Monitor, vps: Server, cloud: Cloud };
const STATUS_DOT: Record<RunsOnStatus, string> = { awake: "bg-success", asleep: "bg-ink/30", offline: "bg-warning" };

/** The card at the top of the tab: where this bot runs and whether it is up, which screen it uses, and the move. */
export function RunsOnCard({ bot, host, status, stage, picker }: {
  bot: Bot;
  host: RunsOnHost;
  status: RunsOnStatus;
  stage: CloudMoveStage | null;
  picker: ReturnType<typeof usePlacePicker>;
}) {
  const { state } = useStore();
  const device = deviceWord();
  const editable = bot.yourAccess !== "view";
  const { options, current, usingNow, choosePlace } = picker;
  const title = host.kind === "mac" ? t("computer.simple.dest.thisMac") : host.kind === "pc" ? t("computer.simple.dest.thisPc")
    : host.kind === "vps" ? host.name ?? t("runsOn.hint.vps") : t("place.cloudDesktop.title");
  const hint = stage === "moved" && !state.config?.cloudHome ? t("runsOn.hint.moved")
    : host.kind === "cloud" ? t("runsOn.hint.cloud", { device }) : t(`runsOn.hint.${host.kind}`);
  // the screen it uses for computer work, in the card's words: the cloud place on a page of one's own is the VPS's desktop
  const screenLabel = (option: (typeof options)[number]) =>
    option.value === "cloud" && !state.config?.cloudHome ? t("runsOn.screen.vps") : option.label;
  const screens = options.filter((option) => option.value === "local" || option.value === "cloud" || option.value === current);
  const toCloud = host.kind !== "cloud" && stage !== null;
  const cloudLabel = stage === "preparing" || stage === "moving" ? t("runsOn.movingCloud")
    : stage === "moved" || stage === "open" ? t("runsOn.openCloud")
    : stage === "coming-back" ? t("runsOn.movingBack") : t("runsOn.moveCloud");
  const toVps = host.kind !== "vps" && host.kind !== "cloud" && vpsLinkAvailable() && stage !== "moved";
  const toHome = (host.kind === "vps" && stage === "elsewhere") || (host.kind === "cloud" && stage === "moved");
  return (
    <Card label={t("runsOn.title")} anchor="runs-on">
      <div data-panel-row="runs-on" data-runs-on={host.kind} className={rowCls}>
        <RowIcon icon={HOST_ICON[host.kind]} />
        <RowText title={title} hint={hint} />
        <span data-runs-on-status={status} className="flex shrink-0 items-center gap-1.5 pr-1 text-[12px] leading-4 text-ink/[0.68]">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
          {t(`runsOn.status.${status}`)}
        </span>
      </div>
      {screens.length > 1 && (
        <div data-panel-row="screen" className={rowCls}>
          <RowText title={t("runsOn.screen")} hint={usingNow ? t("computer.simple.usingNow", { place: usingNow }) : undefined} />
          <SelectPill<PlaceChoice>
            data-panel-select="place"
            aria-label={t("computer.simple.whereWorks", { name: bot.name })}
            value={current}
            disabled={!editable}
            onChange={choosePlace}
            options={screens.map((option) => ({ value: option.value, label: screenLabel(option), icon: CHOICE_ICON[option.value], disabled: option.disabled, title: option.hint }))}
          />
        </div>
      )}
      {editable && (toCloud || toVps || toHome) && (
        <div className="flex flex-col gap-1 px-2 pb-1.5 pt-1">
          {toCloud && <button type="button" data-panel-action="move-cloud" className={cn(pillPrimaryCls, "w-full")} onClick={() => openCloudMove("cloud")}>{cloudLabel}</button>}
          {(toVps || toHome) && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {toVps && <button type="button" data-panel-action="move-vps" className={quietCls} onClick={openAddVps}>{t("runsOn.moveVps")}</button>}
              {toHome && <button type="button" data-panel-action="move-home" className={quietCls} onClick={() => openCloudMove("home")}>{t("runsOn.moveHome", { device })}</button>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** One small disclosure for what a person rarely needs: the computer's own words for a problem, and its settings. */
function ComputerAdvanced({ detail, cloudDesktop, stage }: { detail: string | null; cloudDesktop: CloudDesktopRow | null; stage: CloudMoveStage | null }) {
  const { dispatch } = useStore();
  return (
    <Disclosure data-panel-advanced="computer" label={t("runsOn.advanced")}>
      <Card>
        {detail && <NoteRow data-sheet-row="problem-detail">{detail}</NoteRow>}
        {cloudDesktop && stage === "manage" && <CloudDesktopListRow cloudDesktop={cloudDesktop} />}
        <NavRow data-panel-row="computer-settings" title={t("runsOn.computerSettings")} onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "computer" })} />
      </Card>
    </Disclosure>
  );
}

export function ComputerTab({ bot, derived }: { bot: Bot; derived: Derived; onOpen: (page: SimplePageId) => void }) {
  const { state } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const picker = usePlacePicker(bot, derived);
  const { current, warning, cloudDesktop } = picker;
  const otherServer = useOtherServerName();
  const [screenBox, setScreenBox] = useState<HTMLElement | null>(null);
  const onScreen = useOnScreen(screenBox);
  const [report, setReport] = useState<InlineReport | null>(null);
  const screenOf = t("computer.screenOf", { name: bot.name });
  const host = runsOnHost({ cloudHome: state.config?.cloudHome === true, otherServer, platform: capabilities.host?.platform ?? "other" });
  const stage = cloudDesktop ? cloudMoveStage(cloudDesktop.view, cloudDesktop.keep) : desktopShowsOtherServer() ? "elsewhere" : null;
  const status = runsOnStatus(state.connected, report?.stage ?? (current === "off" ? "off" : "asleep"));

  return (
    <div data-panel-tabpanel="computer">
      <RunsOnCard bot={bot} host={host} status={status} stage={stage} picker={picker} />
      <div ref={setScreenBox} className="mt-3">
        <Suspense fallback={<AsleepScreen bot={bot} off={current === "off"} />}>
          <ComputerPanel bot={bot} inline visible={onScreen} onReport={setReport} />
        </Suspense>
      </div>
      <div className="mt-[5px] flex min-h-6 items-center pl-1">
        <span data-panel-screen-of="" className="min-w-0 truncate text-[12px] leading-4 tracking-normal text-ink/[0.56]">{screenOf}</span>
      </div>
      <ComputerAdvanced detail={report?.detail ?? null} cloudDesktop={cloudDesktop} stage={stage} />
      {warning}
    </div>
  );
}
