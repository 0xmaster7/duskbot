import { Cloud } from "../icons";
import type { InvestedFacts } from "../../shared/cloud-upsell";
import { investedBy } from "../../shared/cloud-upsell";
import { MASCOT_INK } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { DuskMark } from "./mascot-view";
import { NoticeCard, NotNowButton, PRIMARY_BUTTON } from "./NoticeCard";
import { deviceWord } from "./vps-link/parts";

const BODY = { bots: "cloudUpsell.invested.bots", messages: "cloudUpsell.invested.messages", routines: "cloudUpsell.invested.routines" } as const;

/** someone clearly invested in their bots: dusk cloud, offered once, in the corner, in their own numbers */
export function InvestedCard({ facts, onStart, onNotNow }: { facts: InvestedFacts; onStart: () => void; onNotNow: () => void }) {
  const by = investedBy(facts) ?? "bots";
  return <NoticeCard titleId="invested-title" notice="cloud-invested" icon={Cloud} title={t("cloudUpsell.invested.title")} onDismiss={onNotNow}>
    <div className="mt-2 flex items-start gap-3">
      <span aria-hidden="true" className="shrink-0 pt-0.5"><DuskMark body="kit" colour={MASCOT_INK.blue} state="happy" size={34} label={null} /></span>
      <p className="m-0 text-[13px] leading-relaxed text-ink-secondary">{t(BODY[by], { count: facts[by], device: deviceWord() })}</p>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <button type="button" data-invested-start="" className={PRIMARY_BUTTON} onClick={onStart}>{t("rail.buy")}</button>
      <NotNowButton onClick={onNotNow} />
    </div>
  </NoticeCard>;
}
