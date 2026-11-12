import { lazy, Suspense, useEffect, useRef, useState } from "react";


import { cloudMoveStage, openCloudMove, runsOnHost, type CloudMoveStage, type RunsOnHost } from "@/lib/cloud-move";
import { cloudPlanView } from "@/lib/cloud-plan";
import { cn } from "@/lib/cn";
import { writeComputerPanelView, type ComputerPanelView } from "@/lib/computer-panel-view";
import { t } from "@/lib/i18n";
import type { Place } from "@/lib/place";
import { desktopShowsOtherServer, useOtherServerName } from "@/lib/other-server";
import { placeHasIssue, worksOnSimpleLabel } from "@/lib/place-view";
import { useStore, type Bot } from "@/state/store";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { usePlaceViews } from "../PlaceChip";
import type { BotPatch, useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import type { SimplePageId } from "./page-registry";
import type { InlineReport } from "../ComputerPanel";
import { deviceWord } from "../vps-link/parts";
import { Card, NoteRow, RadioRow } from "./rows";
import { CloudHopScene } from "../CloudMoveScene";
import { mdPrimaryCls } from "../ui/GrokDialog";
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


/** a quiet secondary move: plain 12px words that darken on hover, under the one primary action */
const quietCls = "inline-flex h-7 cursor-pointer items-center rounded-full px-2.5 text-[12px] leading-4 text-ink/[0.56] hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** This computer, where a bot stops while it sleeps and has no screen of its own to choose or show. */
const isLocalHost = (host: RunsOnHost) => host.kind === "mac" || host.kind === "pc";


/** Moving a bot from a server to cloud desktop: the same small sky as dusk cloud's card, its mascot hopping over when the
 * button is pointed at, one line and the one primary action. */
function CloudDesktopCta({ bot, stage, label }: { bot: Bot; stage: CloudMoveStage | null; label: string }) {
  const [hopping, setHopping] = useState(false);
  const there = stage === "moved" || stage === "open";
  const moving = stage === "preparing" || stage === "moving" || stage === "coming-back";
  const preview = (on: boolean) => (event: { pointerType: string }) => { if (event.pointerType === "mouse") setHopping(on); };
  return (
    <section data-panel-card="cloud-desktop" data-cloud-cta={there ? "open" : moving ? "moving" : "move"} className="mt-3 overflow-hidden rounded-[16px] first:mt-0 bg-[color-mix(in_srgb,#9fdcf5_28%,transparent)]">
      <CloudHopScene bot={bot} on={there || moving || hopping ? "cloud" : "laptop"} sky={false} className="pt-2" />
      <div className="flex flex-col items-center gap-2.5 px-4 pb-4 pt-1 text-center">
        <p className="m-0 text-pretty text-[13px] leading-[18px] text-ink">{t(there ? "runsOn.cloudDesktopLineThere" : "runsOn.cloudDesktopLine", { name: bot.name })}</p>
        <button type="button" data-panel-action="move-cloud" className={cn(mdPrimaryCls, "w-full")} disabled={moving}
          onClick={() => openCloudMove("cloud")} onPointerEnter={preview(true)} onPointerLeave={preview(false)}
          onFocus={() => setHopping(true)} onBlur={() => setHopping(false)}>{label}</button>
      </div>
    </section>
  );
}

export type CloudCtaStep = "get" | "move" | "moving" | "switch";

/** Where a bot on this computer stands with dusk cloud: no cloud yet, a cloud to move to, on its way, or already there. */
export function cloudCtaStep(stage: CloudMoveStage | null): CloudCtaStep {
  if (stage === null || stage === "buy" || stage === "elsewhere") return "get";
  if (stage === "moved" || stage === "open") return "switch";
  if (stage === "preparing" || stage === "moving" || stage === "coming-back") return "moving";
  return "move";
}

/** dusk cloud for a bot on this computer: its mascot asleep on the laptop, or on the cloud, and the one next step. */
export function CloudCtaCard({ bot, stage, cloudDesktop }: { bot: Bot; stage: CloudMoveStage | null; cloudDesktop: CloudDesktopRow | null }) {
  const { dispatch } = useStore();
  const [hopping, setHopping] = useState(false);
  const step = cloudCtaStep(stage);
  const signedOut = cloudDesktop?.account ? cloudPlanView(cloudDesktop.account).kind === "signed-out" : false;
  const act = () => {
    if (step === "get") dispatch({ type: "openCloudAdd", source: "app_bot_panel", ...(signedOut ? { signIn: true as const } : {}) });
    else if (step === "switch" && cloudDesktop?.openHome) void cloudDesktop.openHome();
    else openCloudMove("cloud");
  };
  const label = t(step === "get" ? "runsOn.getCloud" : step === "switch" ? "runsOn.switchCloud" : step === "moving" ? "runsOn.movingCloud" : "runsOn.moveDuskCloud");
  // pointing at the button previews the hop; a tap on touch would leave it stuck, so only a mouse does
  const preview = (on: boolean) => (event: { pointerType: string }) => { if (event.pointerType === "mouse") setHopping(on); };
  return (
    <section data-panel-card="dusk-cloud" data-cloud-cta={step} className="mt-3 overflow-hidden rounded-[16px] first:mt-0 bg-[color-mix(in_srgb,#9fdcf5_28%,transparent)]">
      <CloudHopScene bot={bot} on={step === "switch" || step === "moving" || hopping ? "cloud" : "laptop"} asleep={step === "get"} sky={false} className="pt-2" />
      <div className="flex flex-col items-center gap-2.5 px-4 pb-4 pt-1 text-center">
        <p className="m-0 text-pretty text-[13px] leading-[18px] text-ink">{t(step === "switch" ? "runsOn.cloudLineThere" : "runsOn.cloudLine", { name: bot.name })}</p>
        <button type="button" data-panel-action="move-cloud" className={cn(mdPrimaryCls, "w-full")} disabled={step === "moving"}
          onClick={act} onPointerEnter={preview(true)} onPointerLeave={preview(false)}
          onFocus={() => setHopping(true)} onBlur={() => setHopping(false)}>{label}</button>
      </div>
    </section>
  );
}

/** One small disclosure for what a person rarely needs: the computer's own words for a problem, and its settings. */
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
  const editable = bot.yourAccess !== "view";
  const local = isLocalHost(host);
  // a bot on a server moves to cloud desktop; one on dusk cloud that came from this computer can go back
  const toCloud = editable && !local && host.kind !== "cloud" && stage !== null;
  const toHome = editable && host.kind === "cloud" && stage === "moved";
  const cloudLabel = stage === "preparing" || stage === "moving" ? t("runsOn.movingCloud")
    : stage === "moved" || stage === "open" ? t("runsOn.openCloud")
    : stage === "coming-back" ? t("runsOn.movingBack") : t("runsOn.moveCloud");
  const detail = report?.detail ?? null;

  return (
    <div data-panel-tabpanel="computer">
      {local ? editable && <CloudCtaCard bot={bot} stage={stage} cloudDesktop={cloudDesktop} /> : <>
        <div ref={setScreenBox}>
          <Suspense fallback={<AsleepScreen bot={bot} off={current === "off"} />}>
            <ComputerPanel bot={bot} inline visible={onScreen} onReport={setReport} />
          </Suspense>
        </div>
        <div className="mt-[5px] flex min-h-6 items-center pl-1">
          <span data-panel-screen-of="" className="min-w-0 truncate text-[12px] leading-4 tracking-normal text-ink/[0.56]">{host.name ? `${screenOf} · ${host.name}` : screenOf}</span>
        </div>
        {detail && <Card><NoteRow data-sheet-row="problem-detail">{detail}</NoteRow></Card>}
        {toCloud && <CloudDesktopCta bot={bot} stage={stage} label={cloudLabel} />}
        {toHome && (
          <div className="mt-2 flex justify-center">
            <button type="button" data-panel-action="move-home" className={quietCls} onClick={() => openCloudMove("home")}>{t("runsOn.moveHome", { device: deviceWord() })}</button>
          </div>
        )}
      </>}
      {cloudDesktop && stage === "manage" && <Card><CloudDesktopListRow cloudDesktop={cloudDesktop} /></Card>}
      {warning}
    </div>
  );
}
