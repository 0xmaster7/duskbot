// Connecting an AI, as one step of the first run: every AI this app can use as a button with its own logo. A press opens
// that provider's own sign-in in the browser (SignInPill's flows), or its setup under the grid where it has no sign-in
// (EngineSetup: an API key, an install, a local endpoint). A connected AI shows as connected and can't be pressed again;
// the window comes back to the front when a sign-in finishes, and more can be added before going on.
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Server } from "../../icons";
import { EngineSetup } from "@/components/EngineSetup";
import { engineReady } from "@/components/EngineLibrary";
import { CursorMark, PresetProviderMark, ProviderMark } from "@/components/ProviderIcons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { plainSignIn } from "@/lib/onboarding";
import { useStore, type InstanceInfo } from "@/state/store";
import { ConnectAiDialog } from "./ConnectAi";
import { aiName, aiTiles, freeModel, type AiTile, type AiTileId } from "./funnel";
import { PRIMARY, QUIET, SECONDARY, StepArt, StepFrame, TILE } from "./FunnelSteps";
import { SignInPill, pillWay, useSignInPill } from "./SignInPill";
import type { WelcomeAiNow } from "./welcome-ai";

const ready = (instance: InstanceInfo) => engineReady(instance);

function TileMark({ tile, size }: { tile: AiTile<InstanceInfo>; size: number }) {
  switch (tile.id) {
    case "chatgpt": return <ProviderMark driverKind="codex" size={size} />;
    case "claude": return <ProviderMark driverKind="claudeAgent" size={size} />;
    case "grok": return <ProviderMark driverKind="grokAgent" size={size} />;
    case "gemini": return <PresetProviderMark preset="google" size={size} />;
    case "cursor": return <CursorMark size={size} />;
    case "copilot": return <ProviderMark driverKind="copilotAgent" size={size} />;
    case "openrouter": return <PresetProviderMark preset="openrouter" size={size} />;
    case "local": return <Server size={size - 4} strokeWidth={1.5} className="text-ink-secondary" />;
  }
}

const label = (tile: AiTile<InstanceInfo>) => (tile.id === "local" ? t("funnel.ai.local") : tile.label);

/** A local endpoint or a step finished in Terminal keeps its own words; a website sign-in says the plain line. */
function setupFor(instance: InstanceInfo) {
  if (instance.access === "custom") return { intent: "inject" as const };
  return plainSignIn(instance)
    ? { intent: "cloud" as const, description: t("onboarding.engines.signInHint", { name: instance.displayName }) }
    : { intent: "cloud" as const };
}

/** The pressed AI's way in. A website sign-in or an install starts on the press itself; what is left here is the wait,
 * the code to paste back or to enter, or the setup for an AI without a sign-in. */
function Connect({ instance, testing }: { instance: InstanceInfo; testing: boolean }) {
  const pill = useSignInPill(instance);
  const [dialog, setDialog] = useState(false);
  const way = pillWay(instance);
  const begin = useRef(pill);
  begin.current = pill;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (way === "install") void begin.current.install();
    else if (way === "sign-in") void begin.current.start();
  }, [way]);
  if (way !== "dialog") {
    return (
      <div className="flex flex-col items-center gap-2.5">
        <SignInPill pill={pill} instance={{ ...instance, displayName: aiName(instance) }} waiting={testing} onDialog={() => setDialog(true)} />
        {pill.error && <p role="alert" className="text-[13px] leading-[18px] text-danger">{pill.error}</p>}
        {dialog && <ConnectAiDialog tested={null} onClose={() => setDialog(false)} />}
      </div>
    );
  }
  return <EngineSetup instance={instance} {...setupFor(instance)} className="w-full max-w-[440px] rounded-2xl border-0 bg-ink/[0.035] p-4 text-start" />;
}

function AiTileButton({ tile, connected, picked, onPick }: { tile: AiTile<InstanceInfo>; connected: boolean; picked: boolean; onPick: () => void }) {
  if (connected) {
    return (
      <div data-funnel-ai={tile.id} data-connected="" role="listitem" aria-label={t("funnel.ai.connectedName", { name: label(tile) })}
        className="ai-connected place-reveal relative flex h-[96px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-success/[0.09] px-2">
        <span className="grid size-7 place-items-center"><TileMark tile={tile} size={26} /></span>
        <span className="flex max-w-full flex-col items-center">
          <span className="max-w-full truncate text-[13px] leading-[18px] text-ink">{label(tile)}</span>
          <span className="flex items-center gap-1 text-[12px] leading-4 text-success">
            <Check size={12} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />{t("funnel.ai.ready")}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div role="listitem" className="flex">
      <button type="button" data-funnel-ai={tile.id} aria-pressed={picked} onClick={onPick}
        className={cn(TILE, "relative flex h-[96px] w-full flex-col items-center justify-center gap-2 px-2", picked && "bg-ink/[0.08] hover:bg-ink/[0.08]")}>
        <span className="grid size-7 place-items-center"><TileMark tile={tile} size={26} /></span>
        <span className="max-w-full truncate text-[13px] leading-[18px] text-ink">{label(tile)}</span>
      </button>
    </div>
  );
}

/** Brings the app back to the front when an AI becomes connected while this step is open (a sign-in in the browser). */
function useFocusOnConnect(connectedIds: readonly string[]) {
  const seen = useRef<Set<string> | null>(null);
  const key = connectedIds.join(",");
  useEffect(() => {
    const now = new Set(key ? key.split(",") : []);
    const before = seen.current;
    seen.current = now;
    if (before && [...now].some((id) => !before.has(id))) void window.duskDesktop?.focusWindow?.().catch(() => {});
  }, [key]);
}

/** `onNext` says how the person went on (an AI connected, the free model, or later), for the funnel's numbers. `cloud`:
 * the person's dusk cloud is being made meanwhile, which the line says. */
export function AiStep({ tested, cloud = false, onNext }: { tested: WelcomeAiNow | null; cloud?: boolean; onNext: (how: "connected" | "free" | "later") => void }) {
  const { state } = useStore();
  const [picked, setPicked] = useState<AiTileId | null>(null);
  const [more, setMore] = useState(false);
  const tiles = aiTiles(state.instances, ready);
  const free = freeModel(state.instances, ready);
  const connected = tiles.filter((tile) => ready(tile.instance));
  const chosen = tiles.find((tile) => tile.id === picked && !ready(tile.instance));
  useFocusOnConnect(connected.map((tile) => tile.id));

  return (
    <StepFrame art={<StepArt art="plug" />} title={t("funnel.ai.title")} sub={connected.length ? t("funnel.ai.subMore") : cloud ? t("funnel.ai.subCloud") : t("funnel.ai.sub")} wide
      footer={<>
        {connected.length > 0
          ? <button type="button" data-primary="" data-funnel-ai-continue="" onClick={() => onNext("connected")} className={PRIMARY}>{t("funnel.next")}</button>
          : free && <button type="button" data-funnel-free="" onClick={() => onNext("free")} className={SECONDARY}>{t("funnel.ai.free")}</button>}
        <span className="flex flex-wrap items-center justify-center gap-1">
          <button type="button" data-funnel-ai="more" onClick={() => setMore(true)} className={QUIET}>{t("funnel.ai.more")}</button>
          {connected.length === 0 && <button type="button" data-funnel-later="" onClick={() => onNext("later")} className={QUIET}>{t("funnel.ai.later")}</button>}
        </span>
      </>}>
      <div role="list" aria-label={t("funnel.ai.title")} className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4">
        {tiles.map((tile) => (
          <AiTileButton key={tile.id} tile={tile} connected={ready(tile.instance)} picked={picked === tile.id}
            onPick={() => setPicked(picked === tile.id ? null : tile.id)} />
        ))}
      </div>

      {tested?.state === "testing" && (
        <p role="status" data-ai-checking="" className="mt-5 flex items-center gap-2 text-[14px] text-ink-secondary">
          <LoaderCircle size={15} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
          {t("onboarding.engines.checkingAnswer", { name: aiName(tested.instance) })}
        </p>
      )}
      {tested?.state === "failed" && !chosen && (
        <div role="alert" data-ai-silent="" className="mt-5 flex flex-col items-center gap-2 text-[13px] leading-5 text-ink">
          <p>{tested.error ?? t("onboarding.engines.noAnswer", { name: tested.instance.displayName })}</p>
          <button type="button" onClick={tested.retry} className="ui-button ui-button-pill ui-button-sm"><RefreshCw size={12} aria-hidden="true" />{t("common.checkAgain")}</button>
        </div>
      )}
      {chosen && (
        <div key={chosen.id} data-funnel-ai-connect={chosen.id} className="place-reveal mt-6 flex w-full flex-col items-center">
          <Connect instance={chosen.instance} testing={tested?.state === "testing" && tested.instance.instanceId === chosen.instance.instanceId} />
        </div>
      )}
      {more && <ConnectAiDialog tested={tested} onClose={() => setMore(false)} />}
    </StepFrame>
  );
}
