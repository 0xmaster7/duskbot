// Connecting an AI, as one step of the first run: every AI this app can use as a button with its own logo. A pick opens
// its way in under the grid: the provider's own sign-in where there is one (SignInPill), else its setup (EngineSetup:
// an API key, an install, a local endpoint). When one answers its test message the step says so and goes on.
import { useState } from "react";
import { Check, LoaderCircle, RefreshCw, Server } from "../../icons";
import { EngineSetup } from "@/components/EngineSetup";
import { engineReady } from "@/components/EngineLibrary";
import { CursorMark, InstanceProviderMark, PresetProviderMark, ProviderMark } from "@/components/ProviderIcons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { aiWorks, plainSignIn } from "@/lib/onboarding";
import { useStore, type InstanceInfo } from "@/state/store";
import { ConnectAiDialog } from "./ConnectAi";
import { aiName, aiTiles, freeModel, type AiTile, type AiTileId } from "./funnel";
import { PRIMARY, QUIET, StepArt, StepFrame, TILE } from "./FunnelSteps";
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

/** The picked AI's way in: its sign-in button, then the code or the wait, in the pill's own slot. */
function Connect({ instance, testing }: { instance: InstanceInfo; testing: boolean }) {
  const pill = useSignInPill(instance);
  const [dialog, setDialog] = useState(false);
  if (ready(instance)) {
    return <p role="status" className="flex items-center gap-2 text-[14px] text-success"><Check size={15} strokeWidth={2.5} aria-hidden="true" />{t("funnel.ai.connectedName", { name: aiName(instance) })}</p>;
  }
  if (pillWay(instance) !== "dialog") {
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

export function AiStep({ tested, onNext, onLater }: { tested: WelcomeAiNow | null; onNext: () => void; onLater: () => void }) {
  const { state } = useStore();
  const [picked, setPicked] = useState<AiTileId | null>(null);
  const [changing, setChanging] = useState(false);
  const [more, setMore] = useState(false);
  const tiles = aiTiles(state.instances, ready);
  const free = freeModel(state.instances, ready);
  const connected = tested && aiWorks(tested) ? tested.instance : undefined;
  const chosen = tiles.find((tile) => tile.id === picked);

  if (connected && !changing) {
    return (
      <StepFrame
        art={<span className="place-mark grid size-16 place-items-center rounded-[20px] bg-ink/[0.035]"><InstanceProviderMark instance={connected} size={34} /></span>}
        title={t("funnel.ai.using", { name: aiName(connected) })}
        sub={t("funnel.ai.usingSub")}
        footer={<>
          <button type="button" data-primary="" data-funnel-ai-continue="" autoFocus onClick={onNext} className={PRIMARY}>{t("funnel.next")}</button>
          <button type="button" data-funnel-ai-change="" onClick={() => setChanging(true)} className={QUIET}>{t("funnel.ai.change")}</button>
        </>} />
    );
  }

  return (
    <StepFrame art={<StepArt art="plug" />} title={t("funnel.ai.title")} sub={t("funnel.ai.sub")} wide
      footer={<>
        {connected && <button type="button" data-primary="" onClick={onNext} className={PRIMARY}>{t("funnel.next")}</button>}
        {!connected && free && <button type="button" data-funnel-free="" onClick={onNext} className={QUIET}>{t("funnel.ai.free")}</button>}
        <span className="flex flex-wrap items-center justify-center gap-1">
          <button type="button" data-funnel-ai="more" onClick={() => setMore(true)} className={QUIET}>{t("funnel.ai.more")}</button>
          {!connected && <button type="button" data-funnel-later="" onClick={onLater} className={QUIET}>{t("funnel.ai.later")}</button>}
        </span>
      </>}>
      <div role="group" aria-label={t("funnel.ai.title")} className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4">
        {tiles.map((tile) => {
          const on = ready(tile.instance);
          return (
            <button key={tile.id} type="button" data-funnel-ai={tile.id} aria-pressed={picked === tile.id}
              onClick={() => setPicked(picked === tile.id ? null : tile.id)}
              className={cn(TILE, "relative flex h-[92px] flex-col items-center justify-center gap-2.5 px-2", picked === tile.id && "bg-ink/[0.08] hover:bg-ink/[0.08]")}>
              <span className="grid size-7 place-items-center"><TileMark tile={tile} size={26} /></span>
              <span className="max-w-full truncate text-[13px] leading-[18px] text-ink">{label(tile)}</span>
              {on && <span className="absolute end-2 top-2 grid size-4 place-items-center rounded-full bg-success text-app" title={t("funnel.ai.ready")}>
                <Check size={10} strokeWidth={3} aria-hidden="true" /><span className="sr-only">{t("funnel.ai.ready")}</span>
              </span>}
            </button>
          );
        })}
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
