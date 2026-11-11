import { useEffect, useRef, useState } from "react";
import { ChevronRight, Cloud, RotateCw } from "../../icons";
import { WorkingDots } from "@/components/WorkingIndicator";
import { t } from "@/lib/i18n";
import type { TypedPairing } from "../connection/pair";
import { haptic } from "../haptics";
import { useMobileAccount } from "./AccountGate";
import type { CloudPairResult, MobileCloud } from "./account-client";
import { cloudPairing, cloudPairingPayload } from "./cloud-pair";

type Problem = { outcome: Exclude<CloudPairResult["outcome"], "paired">; name: string };

function statusLine(cloud: MobileCloud): string {
  if (cloud.asleep) return t("mobile.clouds.asleep");
  if (cloud.status === "ready" || cloud.status === "offline") return t("mobile.clouds.ready");
  if (cloud.status === "setting_up") return t("mobile.clouds.settingUp");
  return t("mobile.clouds.stopped");
}

const pairable = (cloud: MobileCloud) => Boolean(cloud.origin) && (cloud.status === "ready" || cloud.status === "offline");

/** The signed-in account's own Clouds on the link screen: one tap pairs this phone with one. */
export function CloudPicker({ busy, onPairing }: { busy: boolean; onPairing(payload: TypedPairing): Promise<void> }) {
  const account = useMobileAccount();
  const signedIn = Boolean(account?.account);
  const [clouds, setClouds] = useState<MobileCloud[] | null | undefined>(undefined);
  const [working, setWorking] = useState<{ id: string; waking: boolean } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reload, setReload] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!signedIn || !account) return;
    let active = true;
    setClouds(undefined);
    void account.clouds().then((list) => { if (active) setClouds(list); });
    return () => { active = false; };
  }, [account, signedIn, reload]);
  useEffect(() => () => abort.current?.abort(), []);

  if (!signedIn || !account) return null;

  const pick = async (cloud: MobileCloud) => {
    if (working || busy) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);
    setWorking({ id: cloud.id, waking: false });
    try {
      const result = await cloudPairing(account, cloud, { signal: controller.signal, onWaking: () => setWorking({ id: cloud.id, waking: true }) });
      if (controller.signal.aborted) return;
      if (result.outcome !== "paired") { haptic("error"); setProblem({ outcome: result.outcome, name: cloud.name }); return; }
      await onPairing(cloudPairingPayload(cloud, result.grant));
    } finally {
      if (abort.current === controller) setWorking(null);
    }
  };

  return (
    <section aria-label={t("mobile.clouds.title")} data-testid="mobile-cloud-picker" className="mt-7 w-full text-left">
      <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-white/45">{t("mobile.clouds.title")}</h2>
      {clouds === undefined && <p role="status" className="flex items-center gap-2 px-1 text-[15px] text-white/60"><WorkingDots />{t("mobile.clouds.loading")}</p>}
      {clouds === null && (
        <button type="button" onClick={() => setReload((n) => n + 1)} className="mobile-press flex h-11 items-center gap-1.5 px-1 text-[15px] text-white/65"><RotateCw size={15} />{t("mobile.clouds.loadFailed")}</button>
      )}
      {clouds?.length === 0 && <p data-testid="mobile-cloud-none" className="px-1 text-[15px] leading-[1.45] text-white/60">{t("mobile.clouds.none")}</p>}
      {clouds && clouds.length > 0 && (
        <ul className="flex flex-col gap-2">
          {clouds.map((cloud) => {
            const mine = working?.id === cloud.id;
            return (
              <li key={cloud.id}>
                <button type="button" data-testid="mobile-cloud-connect" data-cloud-id={cloud.id} disabled={busy || Boolean(working) || !pairable(cloud)}
                  aria-label={t("mobile.clouds.connect", { name: cloud.name })} onClick={() => void pick(cloud)}
                  className="mobile-press flex min-h-16 w-full items-center gap-3 rounded-[20px] bg-white/[0.08] px-4 py-3 text-left text-white ring-1 ring-white/10 disabled:opacity-60">
                  <Cloud size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{cloud.name}</span>
                    <span className="block text-[13px] text-white/55">{mine ? t(working?.waking ? "mobile.clouds.waking" : "mobile.clouds.connecting", { name: cloud.name }) : statusLine(cloud)}</span>
                  </span>
                  {mine ? <WorkingDots /> : <ChevronRight size={18} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {problem && (
        <p role="alert" className="mt-2 px-1 text-[14px] leading-[1.45] text-white/70">{t(`mobile.clouds.err.${problem.outcome}` as Parameters<typeof t>[0], { name: problem.name })}</p>
      )}
    </section>
  );
}
