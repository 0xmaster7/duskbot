import { useEffect, useRef, useState, type Ref } from "react";
import { ChevronDown } from "../../icons";
import { cloudEngine, cloudEngineChoices, useCloudEngineChoices } from "@/components/CloudEngineSignIn";
import { engineReady } from "@/components/EngineLibrary";
import { EngineCheckLine } from "@/components/EngineLiveCheck";
import { EngineSetup } from "@/components/EngineSetup";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { plainSignIn } from "@/lib/onboarding";
import { Footer, PRIMARY, QUIET, StepHeading } from "./parts";

/** Connecting an AI of the person's own: one that already works when the step opens (signed in here) is used as
 * it is and the step finishes itself; otherwise one recommended sign-in, every other way folded under it. */
export function WelcomeEngine({ name, headingRef, onFinish }: { name: string; headingRef: Ref<HTMLHeadingElement>; onFinish: () => void }) {
  const engines = useCloudEngineChoices();
  const own = engines.instances.some((instance) => engineReady(instance));
  const readyOnOpen = useRef(own);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (readyOnOpen.current) onFinish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (readyOnOpen.current) return null;
  const claude = cloudEngine(engines.instances, "claudeAgent");
  const claudeCheck = claude && engines.live.checks[claude.instanceId];
  const others = { ...engines, choices: engines.choices.filter((choice) => choice.id !== "claude") };
  return <section aria-labelledby="cloud-welcome-step" data-welcome-step="engine" className="flex flex-col">
    <StepHeading headingRef={headingRef} title={t("cloudSetup.engine.title")} sub={t("cloudWelcome.engine.sub", { name })} />
    {claude && <div data-welcome-recommended={claude.instanceId} className="mt-6 rounded-2xl border border-transparent bg-card px-4 py-4">
      {engineReady(claude)
        ? claudeCheck && <EngineCheckLine name={claude.displayName} check={claudeCheck} onRetry={() => void engines.live.run(claude.instanceId)} />
        : <EngineSetup instance={claude} unframed description={plainSignIn(claude) ? t("onboarding.engines.signInHint", { name: claude.displayName }) : undefined} />}
    </div>}
    <button type="button" data-welcome-other-ways aria-expanded={more} onClick={() => setMore((value) => !value)}
      className="mt-4 flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink motion-reduce:transition-none">
      {t("onboarding.engines.otherWays")}
      <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-200 motion-reduce:transition-none", more && "rotate-180")} />
    </button>
    {more && cloudEngineChoices(others, { columns: others.choices.length === 1 ? "grid-cols-1" : "grid-cols-1 @sm/step:grid-cols-2" })}
    <Footer className="mt-7">
      {own
        ? <button type="button" className={PRIMARY} onClick={onFinish}>{t("onboarding.continue")}</button>
        : <button type="button" className={QUIET} onClick={onFinish}>{t("cloudIntent.skip")}</button>}
    </Footer>
  </section>;
}
