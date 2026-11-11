import { useEffect, useRef, useState } from "react";
import { alwaysOnCooling, markAlwaysOn, trackUpsell } from "@/lib/cloud-upsell";
import { t } from "@/lib/i18n";
import { newRoutineSinceBaseline } from "@/lib/routine-cloud-upsell";
import { useStore } from "@/state/store";
import { useCloudUpsell } from "./CloudUpsell";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls } from "./ui/GrokDialog";

export function RoutineCloudUpsell({ quiet = false }: { quiet?: boolean }) {
  const { state } = useStore();
  const upsell = useCloudUpsell();
  const { capabilities } = useDesktopCapabilities();
  const seen = useRef<ReadonlySet<string> | null>(null);
  const shownAt = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (state.routinesLoadState !== "ready") return;
    const next = newRoutineSinceBaseline(seen.current, state.routines);
    seen.current = next.seen;
    if (next.created) setPending(next.created.id);
  }, [state.routines, state.routinesLoadState]);
  const allowed = upsell.allowed === true;
  const waits = quiet || !state.connected || state.appSettingsOpen || state.settingsOpen || state.pluginsOpen
    || state.shortcutsOpen || state.welcomeOpen || Boolean(state.cloudAdd) || state.cloudHowTo || state.botCreationPending;
  useEffect(() => {
    if (!pending || shown || !allowed || waits) return;
    const routine = state.routines.find(entry => entry.id === pending);
    if (!routine?.enabled || routine.heldFor) { setPending(null); return; }
    setPending(null);
    if (shownAt.current || alwaysOnCooling()) return;
    shownAt.current = Date.now();
    markAlwaysOn(shownAt.current);
    trackUpsell("shown", "app_routines");
    setShown(routine.id);
  }, [pending, shown, allowed, waits, state.routines]);
  const routine = state.routines.find(entry => entry.id === shown);
  if (!allowed || waits || !routine?.enabled || routine.heldFor) return null;
  const close = () => { setShown(null); setPending(null); };
  const notNow = () => { trackUpsell("dismiss", "app_routines"); close(); };
  return <GrokDialog title={<span className="block whitespace-normal">{t(capabilities.host.platform === "darwin" ? "routines.cloudUpsell.titleMac" : "routines.cloudUpsell.title")}</span>}
    description={t("routines.cloudUpsell.body", { name: routine.name })} width={460} onClose={notNow}
    footer={<>
      <button type="button" className={mdSecondaryCls} onClick={notNow}>{t("notice.notNow")}</button>
      <button type="button" className={mdPrimaryCls} onClick={() => {
        trackUpsell("click", "app_routines");
        close();
        upsell.open("app_routines");
      }}>{t("routines.cloudUpsell.getCloud")}</button>
    </>}>
    <dl className="my-2 flex flex-col gap-3 text-[13px]">
      <div className="flex items-center justify-between gap-4"><dt>{t("rail.thisComputer")}</dt><dd className="text-ink-secondary">{t("routines.cloudUpsell.asleep")}</dd></div>
      <div className="flex items-center justify-between gap-4"><dt>{t("routines.cloudUpsell.cloud")}</dt><dd className="text-ink-secondary">{t("routines.cloudUpsell.alwaysOn")}</dd></div>
    </dl>
  </GrokDialog>;
}
