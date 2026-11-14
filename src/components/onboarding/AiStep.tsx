// Connecting an AI, as one step of the first run: the grid of AIs people already use (AiCards), and the free model or
// later when none is connected yet. More ways opens every other provider and API keys.
import { useState } from "react";
import { LoaderCircle, RefreshCw } from "../../icons";
import { engineReady } from "@/components/EngineLibrary";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { AiCards } from "./AiCards";
import { ConnectAiDialog } from "./ConnectAi";
import { aiName, aiTiles, freeModel } from "./funnel";
import { PRIMARY, QUIET, SECONDARY, StepArt, StepFrame } from "./FunnelSteps";
import type { WelcomeAiNow } from "./welcome-ai";

/** `onNext` says how the person went on (an AI connected, the free model, or later), for the funnel's numbers. `cloud`:
 * the person's dusk cloud is being made meanwhile, which the line says. */
export function AiStep({ tested, cloud = false, onNext }: { tested: WelcomeAiNow | null; cloud?: boolean; onNext: (how: "connected" | "free" | "later") => void }) {
  const { state } = useStore();
  const [more, setMore] = useState(false);
  const free = freeModel(state.instances, engineReady);
  const connected = aiTiles(state.instances, engineReady).filter((tile) => engineReady(tile.instance));

  return (
    <StepFrame art={<StepArt art="plug" />} title={t("funnel.ai.title")} sub={connected.length ? t("funnel.ai.subMore") : cloud ? t("funnel.ai.subCloud") : t("funnel.ai.sub")} wide
      footer={<>
        {connected.length > 0
          ? <button type="button" data-primary="" data-funnel-ai-continue="" onClick={() => onNext("connected")} className={PRIMARY}>{t("funnel.next")}</button>
          : free && <button type="button" data-funnel-free="" onClick={() => onNext("free")} className={SECONDARY}>{t("funnel.ai.free")}</button>}
        {connected.length === 0 && <button type="button" data-funnel-later="" onClick={() => onNext("later")} className={QUIET}>{t("funnel.ai.later")}</button>}
      </>}>
      <AiCards tested={tested} onMore={() => setMore(true)} />

      {tested?.state === "testing" && (
        <p role="status" data-ai-checking="" className="mt-5 flex items-center gap-2 text-[14px] text-ink-secondary">
          <LoaderCircle size={15} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
          {t("onboarding.engines.checkingAnswer", { name: aiName(tested.instance) })}
        </p>
      )}
      {tested?.state === "failed" && (
        <div role="alert" data-ai-silent="" className="mt-5 flex flex-col items-center gap-2 text-[13px] leading-5 text-ink">
          <p>{tested.error ?? t("onboarding.engines.noAnswer", { name: tested.instance.displayName })}</p>
          <button type="button" onClick={tested.retry} className="ui-button ui-button-pill ui-button-sm"><RefreshCw size={12} aria-hidden="true" />{t("common.checkAgain")}</button>
        </div>
      )}
      {more && <ConnectAiDialog tested={tested} directory onClose={() => setMore(false)} />}
    </StepFrame>
  );
}
