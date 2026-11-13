import { useState } from "react";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { engineReady } from "@/components/EngineLibrary";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { DEFAULT_BOT_NAME } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { aiChoices } from "@/lib/onboarding";
import { useStore, type Bot } from "@/state/store";
import { ConnectAiDialog } from "./ConnectAi";
import { SignInPill, useSignInPill } from "./SignInPill";
import type { WelcomeAiNow } from "./welcome-ai";

/** The first run's only screen, and only when nothing at all can answer the bot yet: one sign-in, every other way one
 * click off, and Later for the chat, where the bot asks again. Everything else happens in the chat. */
export function SignInStep({ bot, tested, onLater }: { bot: Bot | undefined; tested: WelcomeAiNow | null; onLater: () => void }) {
  const { state } = useStore();
  const reduced = usePrefersReducedMotion();
  const name = bot?.name || DEFAULT_BOT_NAME;
  const { recommended } = aiChoices(state.instances.filter((instance) => instance.install && !engineReady(instance)));
  const pill = useSignInPill(recommended);
  const [dialog, setDialog] = useState(false);
  const failure = pill.error ?? (tested?.state === "failed" ? tested.error ?? t("onboarding.engines.noAnswer", { name: tested.instance.displayName }) : null);

  return (
    <div className="onboarding-step-in relative flex min-h-full w-full flex-col items-center px-4">
      <div data-sign-in-step="" className="my-auto flex w-full max-w-[440px] flex-col items-center gap-6 pb-10 pt-16 text-center">
        <span className="flex size-12" aria-hidden="true">
          {bot ? <BotAvatar bot={bot} size={48} state="idle" animated={!reduced} />
            : <MausAvatar color="chrome" size={48} state="idle" animated={!reduced} label={DEFAULT_BOT_NAME} />}
        </span>
        <h1 id="welcome-title" className="text-balance text-[15px] leading-[22px] text-ink">{t("onboarding.start.ai.connect", { name })}</h1>
        <div className="flex flex-col items-center gap-3 text-[13px] leading-[18px]">
          <SignInPill pill={pill} instance={recommended} waiting={tested?.state === "testing"} onDialog={() => setDialog(true)} />
          <p className="text-ink-secondary">
            <button type="button" onClick={() => setDialog(true)} className="rounded hover:text-ink">{t("onboarding.meet.otherWays")}</button>
            <span aria-hidden="true"> · </span>
            <button type="button" data-welcome-later="" onClick={onLater} className="rounded hover:text-ink">{t("onboarding.meet.setupLater")}</button>
          </p>
          {failure && <p role="alert" className="text-danger">{failure}</p>}
        </div>
      </div>
      {dialog && <ConnectAiDialog tested={tested} onClose={() => setDialog(false)} />}
    </div>
  );
}
