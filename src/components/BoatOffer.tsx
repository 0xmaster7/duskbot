import { useId, useState } from "react";
import { Gift, Mail } from "lucide-react";
import { track } from "@/lib/analytics";
import { openEmailDraft } from "@/lib/app-links";
import { BOAT_OFFER, boatClaimMailto, boatOfferRuns } from "@/lib/boat-offer";
import { brandStatus } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { LinkButton, NoticeCard, NotNowButton, PRIMARY_BUTTON } from "./NoticeCard";
import { FormDialog } from "./ListRows";
import { smallButtonCls } from "./ui/GrokDialog";
import { KeyPlainRow, KeyRowMark } from "./keys/KeyRow";

export type BoatOfferAction = "get_boat" | "claim" | "not_now" | "close";
type BoatOfferPlace = "card" | "settings";

export function reportBoatOffer(action: BoatOfferAction | "shown", place: BoatOfferPlace) {
  track("boat_offer", { action, place });
}

function BoatOfferWords() {
  return <>
    <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">{t("boatOffer.body")}</p>
    <p data-boat-offer-yourself className="mt-2 text-[13px] font-semibold leading-[18px] text-ink">{t("boatOffer.yourself")}</p>
  </>;
}

const CLAIM_BUTTON = "ui-button min-h-9 gap-1.5 px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function ClaimButton({ onOpened, className, small = false }: { onOpened?: () => void; className?: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div>
    <button type="button" data-boat-claim className={small ? className : cn(CLAIM_BUTTON, className)} onClick={() => {
      setFailed(false);
      void openEmailDraft(boatClaimMailto()).then(onOpened, () => setFailed(true));
    }}>
      <Mail size={14} aria-hidden="true" className="shrink-0" />{t("boatOffer.claim")}
    </button>
    {failed && <p role="alert" className="mt-2 text-[12px] text-danger">{t("boatOffer.mailFailed", { address: BOAT_OFFER.claimTo })}</p>}
  </div>;
}

export function BoatOfferCard({ onDone }: { onDone: (action: BoatOfferAction) => void }) {
  return <NoticeCard titleId="boat-offer-title" notice="boat-offer" icon={Gift} title={t("boatOffer.title")} onDismiss={() => onDone("close")}>
    <BoatOfferWords />
    <div className="mt-3 flex flex-col gap-2">
      <LinkButton url={BOAT_OFFER.url} label={t("boatOffer.get")} className={cn(PRIMARY_BUTTON, "w-full")} onOpened={() => onDone("get_boat")} />
      <ClaimButton className="w-full" onOpened={() => onDone("claim")} />
      <NotNowButton onClick={() => onDone("not_now")} />
    </div>
  </NoticeCard>;
}

/** Settings' quiet row for Boat's credit while it runs: Claim opens the offer's words and its two actions. */
export function BoatOfferRow() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  if (!boatOfferRuns(Date.now()) || brandStatus().source === "file") return null;
  const name = t("boatOffer.row");
  return (
    <KeyPlainRow data-boat-offer="" titleId={titleId} mark={<KeyRowMark icon={Gift} />} title={name}
      actions={<button type="button" data-boat-offer-open="" className={smallButtonCls} aria-label={`${t("boatOffer.claimShort")}: ${name}`} onClick={() => setOpen(true)}>{t("boatOffer.claimShort")}</button>}>
      {open && (
        <FormDialog data-panel-modal="boat-offer" title={t("boatOffer.title")} description={t("boatOffer.body")} onClose={() => setOpen(false)}>
          <div data-boat-offer-dialog="" className="flex flex-col gap-3">
            <p data-boat-offer-yourself className="m-0 text-[13px] leading-[18px] text-ink">{t("boatOffer.yourself")}</p>
            <div className="flex flex-wrap items-start gap-1.5">
              <LinkButton url={BOAT_OFFER.url} label={t("boatOffer.get")} className={cn(smallButtonCls, "[&_svg]:size-3")} onOpened={() => reportBoatOffer("get_boat", "settings")} />
              <ClaimButton small className={cn(smallButtonCls, "[&_svg]:size-3")} onOpened={() => reportBoatOffer("claim", "settings")} />
            </div>
          </div>
        </FormDialog>
      )}
    </KeyPlainRow>
  );
}
