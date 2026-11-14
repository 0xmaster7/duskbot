// The first run's pause after "this Mac": dusk cloud runs bots 24/7, here they stop when it sleeps; price when known. Either way on is one press; closing it leaves the choice open.
import { offerTrialDays, usd } from "@/lib/cloud-plan";
import { t } from "@/lib/i18n";
import { useCloudOffer } from "@/lib/use-cloud-offer";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls } from "../ui/GrokDialog";
import { PlaceArt } from "../ui/PlaceArt";

export function MacPickSheet({ onCloud, onMac, onClose }: { onCloud: () => void; onMac: () => void; onClose: () => void }) {
  const offer = useCloudOffer(true);
  const trialDays = offerTrialDays(offer);
  const cheapest = offer?.plans.length ? Math.min(...offer.plans.map((plan) => plan.amount)) : null;
  const price = cheapest !== null ? usd(cheapest / 100) : null;
  return (
    <GrokDialog data-panel-modal="mac-pick" art={<PlaceArt name="mac" size={44} />} width={440} onClose={onClose}
      title={<span className="block whitespace-normal">{t("cloudMove.macPick.title")}</span>}
      footer={<>
        <button type="button" data-mac-pick="mac" className={mdSecondaryCls} onClick={onMac}>{t("cloudMove.macPick.mac")}</button>
        <button type="button" data-mac-pick="cloud" data-autofocus="" className={mdPrimaryCls} onClick={onCloud}>{t("cloudMove.macPick.cloud")}</button>
      </>}>
      <div className="text-[13px] leading-[18px] text-ink">
        <p className="m-0 text-pretty text-ink/[0.68]">{t("cloudMove.macPick.body")}</p>
        {price && <p data-mac-pick-price="" className="m-0 mt-4 text-ink/[0.56]">{trialDays ? t("cloudMove.trialPrice", { days: trialDays, price }) : t("cloudMove.price", { price })}</p>}
      </div>
    </GrokDialog>
  );
}
