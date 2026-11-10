import { type Ref } from "react";
import { Check, Laptop, Loader2, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { listOf } from "@/lib/cloud-send";
import { t } from "@/lib/i18n";
import { BringMyCloud } from "./BringMyCloud";
import { CARD, CARD_IDLE, CARD_PICKED, CardIcon, Footer, PRIMARY, StepHeading } from "./parts";

export type BringOutcome = "here" | "skipped";

export function WelcomeBring({ name, desktop, older = false, cloudHasWork, sent = null, team = false, headingRef, onFinish }: {
  name: string;
  /** A Team Cloud: nothing comes here from a person's computer by itself; it starts with bots of its own. */
  team?: boolean;
  /** The Dusk Bot app's own window, which brings this computer's bots here by itself. */
  desktop: boolean;
  /** A Dusk Bot app from before it brought bots by itself: it needs an update first. */
  older?: boolean;
  /** The Cloud has bots or chats of its own (from a phone, say). */
  cloudHasWork: boolean;
  /** This computer's things come (or came) over: one line, nothing to choose or press, a fresh start only behind More.
   * `arrived`: what the last whole send brought, as countedList names it. */
  sent?: { state: "sending" | "sent"; arrived: string[] | null } | null;
  headingRef: Ref<HTMLHeadingElement>;
  onFinish: (outcome: BringOutcome) => void;
}) {
  const freshBody = <>
    <CardIcon icon={Sparkles} />
    <span className="text-[15px] font-semibold text-ink">{t("cloudWelcome.bring.fresh")}</span>
    <span className="text-[13px] leading-relaxed text-ink-secondary">{t("cloudWelcome.bring.freshChief")}</span>
  </>;

  if (sent) {
    const arrived = sent.arrived?.length ? t("cloudSend.strip.arrived", { list: listOf(sent.arrived) }) : t("cloudSend.strip.allHere");
    const line = sent.state === "sending" ? t("cloudWelcome.bring.sending") : arrived;
    return <section aria-labelledby="cloud-welcome-step" data-welcome-step="bring" data-bring-sent={sent.state} className="flex flex-col gap-5">
      <StepHeading headingRef={headingRef} title={t("cloudWelcome.bring.hereTitle")}
        sub={<span role="status" className="inline-flex items-start gap-2">
          {sent.state === "sending" ? <Loader2 size={15} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin" /> : <Check size={15} strokeWidth={2.5} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />}
          <span>{line}</span>
        </span>} />
    </section>;
  }

  const actions = cloudHasWork
    ? <button type="button" className={PRIMARY} onClick={() => onFinish("here")}>{t("onboarding.continue")}</button>
    : <button type="button" className={PRIMARY} onClick={() => onFinish("skipped")}>{t("onboarding.continue")}</button>;
  return <section aria-labelledby="cloud-welcome-step" data-welcome-step="bring" className="flex flex-col gap-5">
    <StepHeading headingRef={headingRef} title={t("cloudWelcome.bring.title", { name })} sub={t(team ? "cloudWelcome.bring.subTeam" : "cloudWelcome.bring.sub", { name })} />
    {older && <p role="note" data-bring-update className="text-[13px] leading-relaxed text-ink">{t("cloudWelcome.bring.update")}</p>}
    {team && desktop && <BringMyCloud />}
    {cloudHasWork
      ? <div data-bring-here className={cn(CARD, CARD_IDLE)}>
          <CardIcon icon={Users} />
          <span className="text-[15px] font-semibold text-ink">{t("cloudWelcome.bring.hereTitle")}</span>
          <span className="text-[13px] leading-relaxed text-ink-secondary">{t("cloudWelcome.bring.hereBody", { name })}</span>
        </div>
      : <div className="grid gap-3 @lg/step:grid-cols-2">
          <div data-bring-choice="fresh" className={cn(CARD, CARD_PICKED)}>{freshBody}</div>
          {!desktop && <div data-bring-desktop className={cn(CARD, "border-dashed border-hairline/60 bg-transparent")}>
            <CardIcon icon={Laptop} />
            <span className="text-[15px] font-semibold text-ink">{t("cloudWelcome.bring.desktopTitle")}</span>
            <span className="text-[13px] leading-relaxed text-ink-secondary">{t("cloudWelcome.bring.desktopOnly")}</span>
          </div>}
        </div>}
    <Footer>{actions}</Footer>
  </section>;
}
