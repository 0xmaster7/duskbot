import { useEffect, useRef, useState } from "react";
import { buyOfferAllowed } from "@/lib/cloud-plan";
import { t } from "@/lib/i18n";
import { newRoutineSinceBaseline } from "@/lib/routine-cloud-upsell";
import { useStore } from "@/state/store";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { localDesktopPage } from "./onboarding/WelcomeGate";
import { useCloudPlan } from "./ProIntroduction";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls } from "./ui/GrokDialog";

const SHOWN_KEY = "omb-routine-cloud-upsell-at";
const COOLDOWN = 30 * 86_400_000;

export function RoutineCloudUpsell({ quiet = false }: { quiet?: boolean }) {
  const { state, dispatch } = useStore();
  const plan = useCloudPlan();
  const { capabilities } = useDesktopCapabilities();
  const seen = useRef<ReadonlySet<string> | null>(null);
  const shownAt = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const organization = window.ogb?.organization;
  const [managed, setManaged] = useState<boolean | null>(organization ? null : false);
  useEffect(() => {
    if (!organization) return;
    let active = true, updated = false;
    const accept = (next: Awaited<ReturnType<typeof organization.state>>) => {
      if (active) setManaged(next.status !== "signed-out" && Boolean(next.organization));
    };
    const unsubscribe = organization.onState(next => { updated = true; accept(next); });
    void organization.state().then(next => { if (!updated) accept(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [organization]);
  useEffect(() => {
    if (state.routinesLoadState !== "ready") return;
    const next = newRoutineSinceBaseline(seen.current, state.routines);
    seen.current = next.seen;
    if (next.created) setPending(next.created.id);
  }, [state.routines, state.routinesLoadState]);
  const allowed = localDesktopPage() && window.ogb?.remoteClient?.active !== true
    && Boolean(state.config) && !state.config?.cloudHome && !state.config?.managedPolicy && managed === false
    && plan !== null && buyOfferAllowed(plan.view);
  const waits = quiet || !state.connected || state.appSettingsOpen || state.settingsOpen || state.pluginsOpen
    || state.shortcutsOpen || state.welcomeOpen || Boolean(state.cloudAdd) || state.cloudHowTo || state.botCreationPending;
  useEffect(() => {
    if (!pending || shown || !allowed || waits) return;
    const routine = state.routines.find(entry => entry.id === pending);
    if (!routine?.enabled || routine.heldFor) { setPending(null); return; }
    const now = Date.now();
    let last = shownAt.current;
    try { last = Math.max(last, Number(localStorage.getItem(SHOWN_KEY)) || 0); } catch {}
    setPending(null);
    if (last && now - last < COOLDOWN) return;
    shownAt.current = now;
    try { localStorage.setItem(SHOWN_KEY, String(now)); } catch {}
    setShown(routine.id);
  }, [pending, shown, allowed, waits, state.routines]);
  const routine = state.routines.find(entry => entry.id === shown);
  if (!allowed || waits || !routine?.enabled || routine.heldFor) return null;
  const close = () => { setShown(null); setPending(null); };
  return <GrokDialog title={<span className="block whitespace-normal">{t(capabilities.host.platform === "darwin" ? "routines.cloudUpsell.titleMac" : "routines.cloudUpsell.title")}</span>}
    description={t("routines.cloudUpsell.body", { name: routine.name })} width={460} onClose={close}
    footer={<>
      <button type="button" className={mdSecondaryCls} onClick={close}>{t("notice.notNow")}</button>
      <button type="button" className={mdPrimaryCls} onClick={() => {
        close();
        dispatch({ type: "openCloudAdd", source: "app_routines", ...(plan?.view.kind === "signed-out" ? { signIn: true as const } : {}) });
      }}>{t("routines.cloudUpsell.getCloud")}</button>
    </>}>
    <dl className="my-2 flex flex-col gap-3 text-[13px]">
      <div className="flex items-center justify-between gap-4"><dt>{t("rail.thisComputer")}</dt><dd className="text-ink-secondary">{t("routines.cloudUpsell.asleep")}</dd></div>
      <div className="flex items-center justify-between gap-4"><dt>{t("routines.cloudUpsell.cloud")}</dt><dd className="text-ink-secondary">{t("routines.cloudUpsell.alwaysOn")}</dd></div>
    </dl>
  </GrokDialog>;
}
