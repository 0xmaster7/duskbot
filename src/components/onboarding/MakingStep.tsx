// The first run's last screen on dusk cloud: the Cloud being made, step by step as the Admin reports it (the session's
// `clouds` entry, else its `machine`). This computer's AI sign-ins are handed to the Admin once, to be held for that Cloud
// until it runs. Ready opens its chat here; the app may be closed meanwhile and the run resumes on this screen.
import { useEffect, useRef, useState } from "react";
import type { CloudAccountState } from "../../../electron/cloud-account.mjs";
import type { CloudSetupStep } from "../../../electron/cloud-home.mjs";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Checklist, ProgressBar } from "../cloud-buy/parts";
import { PRIMARY, StepFrame } from "./FunnelSteps";
import { PlaceArt } from "../ui/PlaceArt";

const STEPS = [
  ["reserving", "cloudHome.step.reserving"], ["storage", "cloudHome.step.storage"],
  ["starting", "cloudHome.step.starting"], ["checking", "cloudHome.step.checking"],
] as const satisfies ReadonlyArray<readonly [CloudSetupStep, LocaleKey]>;

export type Making =
  | { kind: "waiting" }
  | { kind: "setting-up"; step: CloudSetupStep; progress: number; slow: boolean }
  | { kind: "ready" }
  | { kind: "failed" };

const PROGRESS: Record<CloudSetupStep, number> = { reserving: 0.15, storage: 0.4, starting: 0.65, checking: 0.9 };

/** Where the account's own Cloud is, as the Admin last said. */
export function makingFrom(account: CloudAccountState | null): Making {
  const own = account?.clouds?.find((entry) => entry.primary && entry.runsOn === "cloud");
  if (own) {
    if (own.status === "ready" && own.origin) return { kind: "ready" };
    if (own.status === "setting_up") {
      const step = own.setup?.step ?? "reserving";
      return { kind: "setting-up", step, progress: own.setup?.progress ?? PROGRESS[step], slow: account?.machine?.setup?.slow === true };
    }
    if (own.status === "ended" || own.status === "payment_problem") return { kind: "failed" };
    return { kind: "waiting" };
  }
  const machine = account?.machine;
  if (machine?.status === "ready") return { kind: "ready" };
  if (machine?.status === "provisioning") {
    const step = machine.setup?.step ?? "reserving";
    return { kind: "setting-up", step, progress: PROGRESS[step], slow: machine.setup?.slow === true };
  }
  if (machine?.status === "failed" || machine?.status === "payment-problem") return { kind: "failed" };
  return { kind: "waiting" };
}

export function MakingView({ making, opening, openFailed, onOpen }: { making: Making; opening: boolean; openFailed: boolean; onOpen: () => void }) {
  const ready = making.kind === "ready";
  const at = ready ? STEPS.length : making.kind === "setting-up" ? STEPS.findIndex(([key]) => key === making.step) : 0;
  const progress = ready ? 1 : making.kind === "setting-up" ? making.progress : 0.04;
  return (
    <StepFrame
      art={<PlaceArt name="cloud" size={60} className="place-mark" />}
      title={ready ? t("funnel.making.readyTitle") : t("funnel.making.title")}
      sub={ready ? t("funnel.making.readySub") : making.kind === "failed" ? t("funnel.making.failed") : t("funnel.making.sub")}
      footer={ready ? (
        // ready is ready: the button stays live while the chat opens by itself (a second press waits on the same open)
        <button type="button" data-primary="" data-funnel-open-cloud="" aria-busy={opening || undefined} onClick={onOpen} className={PRIMARY}>{t("funnel.making.open")}</button>
      ) : undefined}
    >
      <div data-funnel-making={making.kind} className="flex w-full max-w-[360px] flex-col gap-3 text-start">
        <ProgressBar value={progress} label={t("funnel.making.progress")} />
        <Checklist label={t("funnel.making.progress")} items={STEPS.map(([key, label], index) => ({
          key, title: t(label, { name: t("funnel.place.cloud") }),
          state: index < at ? "done" as const : index === at && !ready ? "now" as const : "next" as const,
        }))} />
        {making.kind === "setting-up" && making.slow && <p role="status" className="px-3 text-[13px] leading-[18px] text-ink-secondary">{t("cloudHome.slow")}</p>}
        {openFailed && <p role="alert" className="px-3 text-[13px] leading-[18px] text-danger">{t("funnel.making.openFailed")}</p>}
      </div>
    </StepFrame>
  );
}

/** Follows the Admin's word on the Cloud, holds this computer's AI sign-ins for it once, and opens its chat when it is ready. */
export function MakingStep({ onOpened }: { onOpened: () => void }) {
  const bridge = window.duskDesktop?.cloudAccount;
  const [account, setAccount] = useState<CloudAccountState | null>(null);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const stop = bridge.onState((next) => { if (live) setAccount(next); });
    void bridge.state().then((next) => { if (live) setAccount((now) => now ?? next); }, () => {});
    void bridge.refresh().catch(() => {});
    return () => { live = false; stop(); };
  }, [bridge]);

  const held = useRef(false);
  useEffect(() => {
    if (held.current || !bridge?.holdSignIns || account?.status !== "connected") return;
    held.current = true;
    void bridge.holdSignIns().catch(() => {});
  }, [bridge, account?.status]);

  const making = makingFrom(account);
  const open = () => {
    if (!bridge || opening) return;
    setOpening(true);
    setOpenFailed(false);
    void bridge.connectHome().then(() => onOpened(), () => setOpenFailed(true)).finally(() => setOpening(false));
  };
  const autoOpened = useRef(false);
  useEffect(() => {
    if (making.kind !== "ready" || autoOpened.current) return;
    autoOpened.current = true;
    open();
  });
  return <MakingView making={making} opening={opening} openFailed={openFailed} onOpen={open} />;
}
